# scripts/config.py
import os
from dotenv import load_dotenv
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate

# Load .env file
load_dotenv()

# --- Paths ---
SCRIPT_DIR = os.path.dirname(__file__)
PDF_DIRECTORY = os.path.join(SCRIPT_DIR, "data")
CHROMA_STORE_PATH = os.path.join(SCRIPT_DIR, "chroma_store")

# --- Local AI Components (Ollama) ---
os.environ["OPENAI_API_BASE"] = "http://localhost:11434/v1"
os.environ["OPENAI_API_KEY"] = "ollama"
api_key = "ollama"

embedder = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")

# Local LLM Initialization
llm = ChatOpenAI(model="mistral", temperature=0.7)

prompt = ChatPromptTemplate.from_messages([
    ("system", """You are Kimi, a helpful and thoughtful assistant.
Use the "CONTEXT" section to answer questions *if it is relevant*.
If the context is not relevant to the question, or if the user is just making small talk (like "hi" or "thanks"), answer as a general conversational assistant.

CONTEXT:
---
[Retrieved Documents]:
{context}
---
[Chat History Context]:
{chat_history}
---
"""),
    ("human", "{question}")
])