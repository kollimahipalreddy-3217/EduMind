import os
import logging
import asyncio
import shutil
import uuid # For generating IDs
import functools # Import this
from typing import Optional # <-- Import Optional
from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_chroma import Chroma
from langchain_core.documents import Document
import pypdf 

# Import from NEW config file
from scripts.config import PDF_DIRECTORY, CHROMA_STORE_PATH, embedder

# --- MODIFIED IMPORTS ---
from scripts.vector_store import (
    initialize_vectorstore, 
    global_vectorstore, # Keep for other functions
    recreate_collection, # Keep this
    get_chroma_client # <-- IMPORT THIS
)

logger = logging.getLogger(__name__)

# (generate_chunk_ids is unchanged)
def generate_chunk_ids(chunks):
    return [str(uuid.uuid4()) for _ in chunks]

# (add_single_document is unchanged)
async def add_single_document(file_path: str, filename: str):
    logger.info(f"Adding single document to store: {filename}")
    loop = asyncio.get_running_loop()
    
    current_vectorstore = global_vectorstore # Use the current global reference
    if current_vectorstore is None:
        logger.warning("Vectorstore not initialized. Initializing...")
        initialize_vectorstore()
        current_vectorstore = global_vectorstore # Re-fetch after init
        if current_vectorstore is None:
            logger.error("Failed to initialize vectorstore. Aborting add.")
            return
    try:
        loader = PyPDFLoader(file_path)
        documents = await loop.run_in_executor(None, loader.load)
        for doc in documents:
            if not hasattr(doc, 'metadata'): doc.metadata = {}
            doc.metadata["source"] = filename 
        
        text_splitter = RecursiveCharacterTextSplitter(chunk_size=500, chunk_overlap=50)
        chunks = await loop.run_in_executor(None, text_splitter.split_documents, documents)
        
        if not chunks:
            logger.warning(f"No text chunks extracted from {filename}.")
            return
        logger.info(f"Split {filename} into {len(chunks)} chunks.")

        for i, chunk in enumerate(chunks):
            if not hasattr(chunk, 'metadata'):
                chunk.metadata = {'source': filename}
            elif 'source' not in chunk.metadata:
                chunk.metadata['source'] = filename

        chunk_ids = generate_chunk_ids(chunks)
        
        # Use the potentially updated current_vectorstore reference
        add_with_ids = functools.partial(current_vectorstore.add_documents, ids=chunk_ids)
        await loop.run_in_executor(
            None, 
            add_with_ids, 
            chunks 
        )
        logger.info(f"✅ Successfully added {filename} to vector store.")

    except pypdf.errors.PdfReadError:
        logger.error(f"Error reading PDF {filename}. It might be corrupted or encrypted.")
    except Exception as e:
        logger.error(f"Failed to add document {filename}: {e}", exc_info=True)


# (delete_document_from_collection is unchanged)
async def delete_document_from_collection(filename: str):
    logger.info(f"Attempting to delete {filename} from vector store...")
    loop = asyncio.get_running_loop()
    
    current_vectorstore = global_vectorstore # Use the current global reference
    if current_vectorstore is None:
        logger.warning("Vectorstore not initialized. Initializing...")
        initialize_vectorstore()
        current_vectorstore = global_vectorstore # Re-fetch after init
        if current_vectorstore is None:
            logger.error("Failed to initialize vectorstore. Aborting delete.")
            return
    try:
        # Use the potentially updated current_vectorstore reference
        collection = current_vectorstore._collection 
        matching_chunks = await loop.run_in_executor(None, collection.get, None, {"source": filename})
        num_to_delete = len(matching_chunks.get('ids', []))
        
        if num_to_delete == 0:
            logger.warning(f"No chunks found in vector store for source: {filename}. Nothing to delete.")
            return

        await loop.run_in_executor(
            None,
            collection.delete,
            None, 
            {"source": filename} 
        )
        logger.info(f"✅ Successfully deleted {num_to_delete} chunks for {filename} from vector store.")
        
    except Exception as e:
        logger.error(f"Failed to delete document {filename} from store: {e}", exc_info=True)


# --- MODIFIED: Explicitly re-fetch vectorstore instance ---
async def rebuild_vectorstore(collection_name: str = "langchain"):
    """
    Rebuilds the Chroma vector store by deleting and recreating the collection.
    """
    logger.info(f"Starting async Chroma vector store rebuild from {PDF_DIRECTORY}...")
    loop = asyncio.get_running_loop()
    os.makedirs(PDF_DIRECTORY, exist_ok=True)
    
    current_vectorstore: Optional[Chroma] = None # Define type here

    # 🔹 1. Recreate the collection
    try:
        # --- MODIFIED: Run sync function in executor and get return value ---
        current_vectorstore = await loop.run_in_executor(
            None, 
            recreate_collection, 
            collection_name
        )
        if current_vectorstore is None:
             raise Exception("recreate_collection failed to set global_vectorstore or return it")
        logger.info("Successfully recreated collection and initialized vector store.")
    except Exception as e:
        logger.error(f"CRITICAL: Failed to recreate collection: {e}. Aborting rebuild.", exc_info=True)
        return 

    # 🔹 2. Load documents (unchanged)
    all_documents = []
    # ... (loading logic remains the same) ...
    try:
        files_in_dir = await loop.run_in_executor(None, os.listdir, PDF_DIRECTORY)
    except FileNotFoundError:
        logger.warning(f"PDF directory not found: {PDF_DIRECTORY}. Creating it.")
        files_in_dir = []

    for filename in files_in_dir:
        if filename.endswith(".pdf"):
            pdf_path = os.path.join(PDF_DIRECTORY, filename)
            logger.info(f"Loading document: {pdf_path}")
            try:
                loader = PyPDFLoader(pdf_path)
                documents = await loop.run_in_executor(None, loader.load)
                for doc in documents:
                    if not hasattr(doc, 'metadata'): doc.metadata = {}
                    doc.metadata["source"] = filename # Assign filename as source
                all_documents.extend(documents)
            except Exception as e:
                logger.error(f"Failed to load PDF {filename}: {e}", exc_info=True)


    # 🔹 3. Split documents (unchanged)
    if not all_documents:
        logger.warning("No valid PDF documents loaded. Vector store will be empty.")
        return # Nothing to add
    # ... (splitting logic remains the same) ...
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=500,
        chunk_overlap=50
    )
    try:
        chunks = await loop.run_in_executor(None, text_splitter.split_documents, all_documents)
        logger.info(f"Split documents into {len(chunks)} chunks.")
    except Exception as e:
         logger.error(f"Error during text splitting: {e}", exc_info=True)
         return 

    if not chunks:
        logger.warning("Splitting resulted in zero chunks. Vector store will remain empty.")
        return

    # ... (metadata check remains the same) ...
    for i, chunk in enumerate(chunks):
         if not hasattr(chunk, 'metadata'):
              chunk.metadata = {'source': 'unknown_source_after_split'}
         elif 'source' not in chunk.metadata:
              chunk.metadata['source'] = 'unknown_source_after_split'


    # 🔹 4. Add documents iteratively with explicit IDs
    if not chunks:
        logger.warning("No chunks to add. Store will be empty.")
        return
        
    try:
        logger.info(f"Adding {len(chunks)} chunks to the vector store...")
        chunk_ids = generate_chunk_ids(chunks)

        # --- MODIFIED: Use the explicitly fetched current_vectorstore ---
        if current_vectorstore is None: # Should be impossible due to check above, but good practice
            raise ValueError("Vectorstore is None, cannot add documents.")
            
        add_with_ids = functools.partial(current_vectorstore.add_documents, ids=chunk_ids)
        await loop.run_in_executor(
             None, 
             add_with_ids, 
             chunks 
        )

        logger.info("✅ Successfully added documents to the vector store.")
    except Exception as e:
        # Log the ID of the collection we *thought* we were using
        collection_id = "N/A"
        if current_vectorstore and hasattr(current_vectorstore, '_collection') and hasattr(current_vectorstore._collection, 'id'):
            collection_id = current_vectorstore._collection.id
        logger.error(f"CRITICAL: Failed to add documents to vectorstore. Target collection ID was supposed to be [{collection_id}]. Error: {e}", exc_info=True)
    # --- REMOVED THE EXTRA '}' THAT WAS HERE ---