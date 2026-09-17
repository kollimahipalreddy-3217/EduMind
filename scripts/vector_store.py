import os
import logging
from typing import Optional, List
import chromadb # Import the base chromadb library
from chromadb.config import Settings # Import Settings
from langchain_chroma import Chroma
from langchain_core.retrievers import BaseRetriever
from langchain_core.documents import Document
import time # Import time for sleep

# Import static config
from scripts.config import CHROMA_STORE_PATH, embedder

logger = logging.getLogger(__name__)

# Global store components managed *here*
global_vectorstore: Optional[Chroma] = None
global_chroma_client: Optional[chromadb.Client] = None # Added client reference

def get_chroma_client() -> chromadb.Client:
    """Gets or creates the ChromaDB Persistent Client."""
    global global_chroma_client
    if global_chroma_client is None:
        logger.info(f"Creating PersistentClient for path: {CHROMA_STORE_PATH}")
        # Note: allow_reset=True is for client.reset(), which we are avoiding
        global_chroma_client = chromadb.PersistentClient(
            path=CHROMA_STORE_PATH,
            settings=Settings(anonymized_telemetry=False) 
        )
    return global_chroma_client

def clear_vectorstore():
    """
    Safely disposes of the current Chroma vectorstore instance and client.
    This is for graceful shutdown.
    """
    global global_vectorstore, global_chroma_client
    logger.info("Clearing vectorstore and client references...")

    # Clear the Langchain wrapper reference first
    if global_vectorstore is not None:
         del global_vectorstore
         global_vectorstore = None
         logger.info("Global Langchain Chroma reference cleared.")

    # Clear the client reference.
    # We are NOT calling client.reset() here as it causes issues.
    # The persistent client doesn't need an explicit close.
    if global_chroma_client is not None:
        # del global_chroma_client # Deleting might be too aggressive
        global_chroma_client = None
        logger.info("Global ChromaDB client reference cleared.")
    
    # Force garbage collection
    import gc
    gc.collect()
    logger.info("GC triggered after cleanup attempt.")


def initialize_vectorstore(collection_name: str = "langchain"):
    """
    Initializes or loads the Chroma vector store using PersistentClient.
    This function *assumes* the collection exists or should be created.
    """
    global global_vectorstore
    logger.info("Initializing vectorstore wrapper...")
    client = get_chroma_client()
    try:
        # Get or create the collection
        collection = client.get_or_create_collection(collection_name)
        logger.info(f"Using collection: '{collection.name}' with ID: {collection.id}")

        # Create the Langchain wrapper instance
        global_vectorstore = Chroma(
            client=client,
            collection_name=collection_name,
            embedding_function=embedder,
        )
        logger.info("Langchain Chroma wrapper initialized successfully.")

    except Exception as e:
        logger.error(f"Failed to initialize Chroma wrapper: {e}", exc_info=True)
        global_vectorstore = None # Ensure it's None

# --- MODIFIED FUNCTION ---
def recreate_collection(collection_name: str = "langchain") -> Optional[Chroma]:
    """
    Deletes the specified collection if it exists and creates a new one.
    Re-initializes the global_vectorstore and returns it.
    """
    logger.info(f"Attempting to recreate collection: {collection_name}")
    client = get_chroma_client()
    
    # 1. Delete old collection if it exists
    try:
        collections = client.list_collections()
        if any(c.name == collection_name for c in collections):
            logger.warning(f"Collection '{collection_name}' exists. Deleting it...")
            client.delete_collection(name=collection_name)
            logger.info(f"Collection '{collection_name}' deleted.")
            # Give a moment for the deletion to propagate
            time.sleep(0.5) 
        else:
            logger.info(f"Collection '{collection_name}' does not exist. No deletion needed.")
    except Exception as e:
        logger.error(f"Error deleting collection '{collection_name}': {e}. Trying to continue...", exc_info=True)

    # 2. Create new collection and initialize wrapper
    # This will create a new, empty collection
    initialize_vectorstore(collection_name=collection_name)
    
    # 3. --- MODIFIED: Return the new instance ---
    return global_vectorstore


# (get_retriever_with_filter is unchanged)
async def get_retriever_with_filter(active_documents: Optional[List[str]] = None) -> BaseRetriever:
    """Return a Chroma retriever, optionally filtered by document source."""
    if global_vectorstore is None:
        logger.warning("Global vector store wrapper not initialized. Attempting initialization.")
        initialize_vectorstore()
        if global_vectorstore is None:
            logger.error("Failed to initialize vector store wrapper. Using dummy retriever.")
            dummy_store = Chroma.from_texts(["initial setup text."], embedding=embedder)
            return dummy_store.as_retriever(search_kwargs={"k": 5})

    try:
        _ = global_vectorstore._collection.count()
    except Exception as e:
         logger.error(f"Error accessing collection count: {e}. Re-initializing.")
         initialize_vectorstore()
         if global_vectorstore is None:
              logger.error("Failed to re-initialize client. Using dummy retriever.")
              dummy_store = Chroma.from_texts(["initial setup text."], embedding=embedder)
              return dummy_store.as_retriever(search_kwargs={"k": 5})

    search_kwargs = {"k": 5}
    if active_documents:
        logger.info(f"Filtering retriever by documents: {active_documents}")
        search_kwargs["filter"] = {"source": {"$in": active_documents}}
    else:
        logger.info("No active documents specified. Using general retriever.")

    return global_vectorstore.as_retriever(search_kwargs=search_kwargs)

# Initialize on module load
initialize_vectorstore()