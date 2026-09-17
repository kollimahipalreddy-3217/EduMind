import logging
import json
from typing import List
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from langchain_core.documents import Document
from langchain_core.runnables import RunnableLambda
from langchain_core.output_parsers import StrOutputParser
from langchain_core.messages import HumanMessage, AIMessage
from langchain_community.chat_message_histories import ChatMessageHistory

# Import components from config.py
from scripts.config import llm, prompt
# Import from new vector_store module
from scripts.vector_store import get_retriever_with_filter

router = APIRouter()
logger = logging.getLogger(__name__)

# --- Dictionary to hold per-session message history ---
session_histories: dict[str, ChatMessageHistory] = {}


def get_session_history(session_id: str) -> ChatMessageHistory:
    """Gets or creates a ChatMessageHistory for a given session ID."""
    if session_id not in session_histories:
        logger.info(f"Creating new history for session: {session_id}")
        session_histories[session_id] = ChatMessageHistory()
    return session_histories[session_id]


def _format_docs(docs):
    return "\n\n".join(doc.page_content for doc in docs)


def _format_history(messages):
    if not messages:
        return ""
    lines = []
    for msg in messages:
        if isinstance(msg, HumanMessage):
            lines.append(f"Human: {msg.content}")
        elif isinstance(msg, AIMessage):
            lines.append(f"Assistant: {msg.content}")
        else:
            lines.append(str(msg))
    return "\n".join(lines)


def build_session_chain(retriever, history: ChatMessageHistory):
    """
    Build an LCEL streaming chain for a given retriever and session history.
    Returns an object with an astream method yielding {"answer": accumulated_str}.
    """

    def assemble_inputs(inp):
        question = inp["question"]
        docs = retriever.invoke(question)
        return {
            "context": _format_docs(docs),
            "chat_history": _format_history(history.messages),
            "question": question,
        }

    base_chain = (
        RunnableLambda(assemble_inputs)
        | prompt
        | llm
        | StrOutputParser()
    )

    class SessionChain:
        async def astream(self, inp):
            full_answer = ""
            async for token in base_chain.astream({"question": inp["question"]}):
                full_answer += token
                yield {"answer": full_answer}
            # Save to history after streaming completes
            history.add_user_message(inp["question"])
            history.add_ai_message(full_answer)

    return SessionChain()


@router.websocket("/ws/chat")
async def websocket_chat(websocket: WebSocket):
    await websocket.accept()
    logger.info("WebSocket connection accepted.")

    try:
        while True:
            data_str = await websocket.receive_text()
            logger.info(f"Received message: {data_str}")

            session_id = "unknown"
            try:
                # Parse the JSON message from frontend
                data = json.loads(data_str)
                question = data.get("question")
                active_documents = data.get("active_documents", [])
                session_id = data.get("sessionId")

                if not question or not session_id:
                    errmsg = "Error: No question or session ID provided."
                    logger.error(f"{errmsg} Data: {data_str}")
                    await websocket.send_text(json.dumps({
                        "token": errmsg,
                        "sessionId": session_id or "unknown"
                    }))
                    await websocket.send_text(json.dumps({
                        "token": "__END__",
                        "sessionId": session_id or "unknown"
                    }))
                    continue

                # 1. Get the filtered retriever (RAG)
                filtered_retriever = await get_retriever_with_filter(active_documents)

                # 2. Explicitly retrieve documents to check
                try:
                    retrieved_docs: List[Document] = await filtered_retriever.aget_relevant_documents(question)
                    logger.info(f"Retrieved {len(retrieved_docs)} documents for session {session_id}")
                    if not retrieved_docs:
                        logger.warning("Filtered retriever returned ZERO documents!")
                except Exception as retr_err:
                    logger.error(f"Error explicitly retrieving documents: {retr_err}", exc_info=True)

                # 3. Get session-specific history
                current_history = get_session_history(session_id)

                # 4. Create a chain instance for this specific request
                chain = build_session_chain(filtered_retriever, current_history)

                # 5. Stream word-by-word tokens
                last_sent_answer = ""
                logger.info(f"Streaming response for session {session_id}...")
                async for chunk in chain.astream({"question": question}):
                    if "answer" in chunk:
                        current_answer = chunk["answer"]
                        if current_answer != last_sent_answer:
                            new_token = current_answer[len(last_sent_answer):]
                            last_sent_answer = current_answer
                            if new_token:
                                await websocket.send_text(json.dumps({
                                    "token": new_token,
                                    "sessionId": session_id
                                }))

                logger.info(f"Streaming complete for session {session_id}.")

                # 6. Send end-of-stream token
                await websocket.send_text(json.dumps({
                    "token": "__END__",
                    "sessionId": session_id
                }))

            except json.JSONDecodeError:
                logger.error(f"Received non-JSON message: {data_str}")
                await websocket.send_text(json.dumps({
                    "token": "Error: Invalid message format.", "sessionId": "unknown"
                }))
                await websocket.send_text(json.dumps({
                    "token": "__END__", "sessionId": "unknown"
                }))
            except Exception as e:
                logger.error(f"Error during streaming: {e}", exc_info=True)
                await websocket.send_text(json.dumps({
                    "token": "Error: An internal error occurred.",
                    "sessionId": session_id or "unknown"
                }))
                await websocket.send_text(json.dumps({
                    "token": "__END__", "sessionId": session_id or "unknown"
                }))

    except WebSocketDisconnect:
        logger.info("WebSocket connection closed.")
    except Exception as e:
        logger.error(f"Unhandled WebSocket error: {e}", exc_info=True)
        try:
            await websocket.close(code=1011, reason=str(e))
        except:
            pass