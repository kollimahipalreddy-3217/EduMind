# scripts/api.py
import os
import logging
import asyncio
from contextlib import asynccontextmanager
from typing import List, Optional
import requests
import json
import re
import httpx 

from fastapi import FastAPI, UploadFile, File, HTTPException, Path
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel 
import pypdf

from scripts.chatbot import chain, build_chain
from scripts.vector_store import get_retriever_with_filter, clear_vectorstore
from scripts.assessment import evaluate_answers, get_questions, router as assessment_router
from scripts.websocket_chat import router as ws_router
from scripts.ingest import (
    rebuild_vectorstore, 
    PDF_DIRECTORY,
    add_single_document, 
    delete_document_from_collection 
)
from scripts.test_feature import create_mcq_test
from scripts.reports_feature import router as reports_router
from scripts.config import api_key as LOCAL_API_KEY

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)

@asynccontextmanager
async def lifespan(app: FastAPI):
    logging.info("Startup: Triggering initial Chroma vector store build.")
    await rebuild_vectorstore() 
    yield
    logging.info("Shutdown: Clearing Chroma vector store.")
    clear_vectorstore()

app = FastAPI(lifespan=lifespan)

app.include_router(assessment_router)
app.include_router(ws_router)
app.include_router(reports_router, prefix="/api/reports", tags=["reports"])

@app.get("/")
def read_root():
    return {"message": "Kimi Chatbot API is up and running on Local Ollama!"}

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ChatRequest(BaseModel):
    message: str
    active_documents: Optional[List[str]] = None

class GenerateTestRequest(BaseModel):
    document_chunks: List[str]

async def _get_document_text_content(doc_name: str) -> str:
    file_path = os.path.join(PDF_DIRECTORY, doc_name)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail=f"Document '{doc_name}' not found.")
    try:
        text_content = ""
        with open(file_path, "rb") as f:
            reader = pypdf.PdfReader(f)
            for page in reader.pages:
                page_text = page.extract_text()
                if page_text:
                    text_content += page_text + "\n"
        return text_content.strip()
    except Exception as e:
        logging.error(f"Failed to extract text from PDF '{doc_name}': {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to extract text from PDF: {str(e)}")

@app.post("/chat/")
async def chat_endpoint(req: ChatRequest):
    logging.info(f"Received HTTP chat request. Message: '{req.message}'")
    try:
        filtered_retriever = await get_retriever_with_filter(req.active_documents)
        http_chain = build_chain(filtered_retriever)
        response = await http_chain.ainvoke({"question": req.message})
        return {"answer": response["answer"]}
    except Exception as e:
        logging.error(f"HTTP Chat endpoint error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error processing chat: {str(e)}")


@app.post("/generate-test")
async def generate_test_endpoint(req: GenerateTestRequest):
    logging.info(f"Received test generation request with {len(req.document_chunks)} chunks.")
    if not req.document_chunks:
        raise HTTPException(status_code=400, detail="No document chunks provided.")
    try:
        generated_test = create_mcq_test(req.document_chunks)
        if not generated_test or not generated_test.get("questions"):
             raise HTTPException(status_code=500, detail="Failed to generate a valid test.")
        return generated_test
    except Exception as e:
        logging.error(f"Error during test generation: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Test generation error: {str(e)}")


@app.get("/quote/daily")
async def get_daily_quote():
    url = "http://localhost:11434/v1/chat/completions"
    headers = { "Authorization": f"Bearer {LOCAL_API_KEY}", "Content-Type": "application/json" }
    prompt_text = "Generate a single, short, inspirational quote about learning or studying. Return only the quote."
    data = { "model": "mistral", "messages": [{"role": "user", "content": prompt_text}] }

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
             response = await client.post(url, headers=headers, json=data)
             response.raise_for_status()
             content = response.json()['choices'][0]['message']['content']

        cleaned_quote = re.sub(r'\[/?B_INST\]', '', content, flags=re.IGNORECASE).strip()
        cleaned_quote = re.sub(r'<\/?s>', '', cleaned_quote, flags=re.IGNORECASE).strip()
        cleaned_quote = cleaned_quote.strip('"')

        return {"quote": cleaned_quote}
    except Exception as e:
        logging.error(f"Error fetching daily quote: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to generate quote.")


@app.get("/summarize-document/{doc_name:path}")
async def summarize_document_endpoint(doc_name: str):
    logging.info(f"Received request to summarize document: {doc_name}")

    try:
        doc_content = await _get_document_text_content(doc_name)
        if not doc_content:
             return {"summary": "Document appears to be empty."}

        max_summary_input_length = 3500 
        truncated_content = doc_content[:max_summary_input_length]
        if len(doc_content) > max_summary_input_length:
             truncated_content += "..." 

        summary_prompt = f"Provide a concise summary of the key information in the following document text:\n\n---\n{truncated_content}\n---\n\nSummary:"

        url = "http://localhost:11434/v1/chat/completions"
        headers = { "Authorization": f"Bearer {LOCAL_API_KEY}", "Content-Type": "application/json" }
        data = {
            "model": "mistral", 
            "messages": [{"role": "user", "content": summary_prompt}]
        }

        async with httpx.AsyncClient(timeout=120.0) as client: 
             response = await client.post(url, headers=headers, json=data)
             response.raise_for_status()
             summary = response.json()['choices'][0]['message']['content']

        cleaned_summary = re.sub(r'\[/?B_INST\]', '', summary, flags=re.IGNORECASE).strip()
        cleaned_summary = re.sub(r'<\/?s>', '', cleaned_summary, flags=re.IGNORECASE).strip()

        return {"summary": cleaned_summary}

    except HTTPException as http_exc:
         raise http_exc 
    except Exception as e:
        logging.error(f"Error summarizing document '{doc_name}': {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to summarize: {str(e)}")


@app.post("/upload-document/")
async def upload_document(file: UploadFile = File(...)):
    if not file.filename.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed.")

    file_location = os.path.join(PDF_DIRECTORY, file.filename)
    if os.path.exists(file_location):
        raise HTTPException(status_code=400, detail=f"File '{file.filename}' already exists.")
        
    try:
        os.makedirs(PDF_DIRECTORY, exist_ok=True)
        content = await file.read()
        with open(file_location, "wb+") as file_object:
            file_object.write(content)
        
        await add_single_document(file_location, file.filename) 
        return {"message": f"File '{file.filename}' uploaded."}
    except Exception as e:
        if os.path.exists(file_location):
             os.remove(file_location)
        raise HTTPException(status_code=500, detail=f"Could not upload: {str(e)}")

@app.delete("/delete-document/{doc_name:path}")
async def delete_document_endpoint(doc_name: str = Path(..., description="The name of the document to delete")):
    logging.info(f"Received request to delete document: '{doc_name}'")
    file_path = os.path.join(PDF_DIRECTORY, doc_name)
    
    if not os.path.exists(file_path):
        logging.error(f"Document not found for deletion: {file_path}")
        raise HTTPException(status_code=404, detail="Document not found.")
        
    try:
        await delete_document_from_collection(doc_name)
        
        os.remove(file_path)
        logging.info(f"Successfully deleted file: {file_path}")
        
        return {"message": f"File '{doc_name}' deleted from disk and knowledge base."} 
    except Exception as e:
        logging.error(f"Error deleting file '{doc_name}': {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Could not delete file: {str(e)}")


@app.get("/document-text/{doc_name:path}")
async def get_document_text(doc_name: str):
    content = await _get_document_text_content(doc_name)
    return {"content": content}


@app.get("/documents")
async def list_documents():
    try:
        if not os.path.exists(PDF_DIRECTORY):
             os.makedirs(PDF_DIRECTORY, exist_ok=True)
             return {"documents": []}
        pdf_files = [entry.name for entry in os.scandir(PDF_DIRECTORY) if entry.is_file() and entry.name.endswith(".pdf")]
        logging.info(f"Listed documents: {pdf_files}")
        return {"documents": sorted(pdf_files)} 
    except Exception as e:
        logging.error(f"Error listing documents: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Could not list documents: {str(e)}")