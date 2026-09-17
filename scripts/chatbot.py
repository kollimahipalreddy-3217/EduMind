import logging
from langchain_core.documents import Document
from langchain_core.retrievers import BaseRetriever
from langchain_core.runnables import RunnableLambda
from langchain_core.output_parsers import StrOutputParser
from langchain_core.messages import HumanMessage, AIMessage
from langchain_community.chat_message_histories import ChatMessageHistory

# Import from config
from scripts.config import llm, prompt
# Import from new vector_store module
from scripts.vector_store import global_vectorstore, initialize_vectorstore

logger = logging.getLogger(__name__)

# Global shared memory for the HTTP chain (used by api.py /chat/ endpoint)
_global_history = ChatMessageHistory()


class EmptyRetriever(BaseRetriever):
    async def _aget_relevant_documents(self, query: str):
        return [Document(page_content="No context available yet.")]
    def _get_relevant_documents(self, query: str):
        return [Document(page_content="No context available yet.")]


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


def build_chain(retriever, history: ChatMessageHistory = None):
    """
    Build an LCEL conversational retrieval chain.
    Returns an object with invoke and ainvoke that return {"answer": str}.

    Parameters
    ----------
    retriever : a LangChain retriever
    history   : a ChatMessageHistory instance to track conversation.
                If None, a fresh one is created.
    """
    if history is None:
        history = ChatMessageHistory()

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

    class WrappedChain:
        def invoke(self, inp):
            result = base_chain.invoke(inp)
            history.add_user_message(inp["question"])
            history.add_ai_message(result)
            return {"answer": result}

        async def ainvoke(self, inp):
            result = await base_chain.ainvoke(inp)
            history.add_user_message(inp["question"])
            history.add_ai_message(result)
            return {"answer": result}

    return WrappedChain()


# ---------------------------------------------------------------------------
# Module-level chain (used by api.py import: `from scripts.chatbot import chain`)
# ---------------------------------------------------------------------------
if global_vectorstore is None:
    initialize_vectorstore()

_retriever = (
    global_vectorstore.as_retriever(search_kwargs={"k": 3})
    if global_vectorstore
    else EmptyRetriever()
)

chain = build_chain(_retriever, _global_history)