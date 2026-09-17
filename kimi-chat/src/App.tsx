import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import ReactMarkdown from 'react-markdown';
import TestFeature from './TestFeature';
import ReportsFeature from './ReportsFeature';
import LoadingIndicator from './LoadingIndicator';
import LoginPage from './LoginPage'; // Import the new Login page
import { v4 as uuidv4 } from 'uuid'; // Import UUID for session IDs

// Types
type Message = {
  sender: 'user' | 'bot';
  text: string;
};

// --- MODIFIED: Session Type now includes isLoading ---
type Session = {
  id: string;
  name: string;
  messages: Message[];
  isLoading: boolean; // <-- ADDED
};

type Note = {
  id: string;
  content: string;
};

type Question = {
  question: string;
  options: {
    type: string;
    text: string;
  }[];
};

type AssessmentResult = {
  learning_style: string;
  description: string;
};

type Document = {
  name: string;
  active: boolean;
};

// API Service
const API_BASE_URL = "http://127.0.0.1:8000";
const WS_BASE_URL = "ws://127.0.0.1:8000"; 
// Read OpenRouter API Key from environment variable (REACT_APP_OPENROUTER_API_KEY in .env)
const OPENROUTER_API_KEY = process.env.REACT_APP_OPENROUTER_API_KEY || "";


const apiService = {
  // ... (getQuestions, evaluateAssessment, getDocuments, uploadDocument, deleteDocument, generateTest, getDailyQuote, getDocumentText)
  // ... (These functions are unchanged) ...
  getQuestions: async (signal?: AbortSignal) => {
    const response = await fetch(`${API_BASE_URL}/assessment/questions`, { signal });
    if (!response.ok) throw new Error("Failed to fetch questions");
    return response.json();
  },

  evaluateAssessment: async (answers: string[], signal?: AbortSignal) => {
    const response = await fetch(`${API_BASE_URL}/assessment/evaluate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers }),
      signal
    });
    if (!response.ok) throw new Error("Assessment evaluation failed");
    return response.json();
  },

  getDocuments: async (signal?: AbortSignal) => {
    const response = await fetch(`${API_BASE_URL}/documents`, { signal });
    if (!response.ok) throw new Error("Failed to fetch documents");
    return response.json();
  },

  uploadDocument: async (file: File, signal?: AbortSignal) => {
    const formData = new FormData();
    formData.append("file", file);
    const response = await fetch(`${API_BASE_URL}/upload-document/`, {
      method: "POST",
      body: formData,
      signal
    });
    if (!response.ok) throw new Error("File upload failed");
    return response.json();
  },
  deleteDocument: async (docName: string, signal?: AbortSignal) => {
    const response = await fetch(`${API_BASE_URL}/delete-document/${encodeURIComponent(docName)}`, {
      method: "DELETE",
      signal
    });
    if (!response.ok) throw new Error("Delete request failed");
    return response.json();
  },
  generateTest: async (documentChunks: string[], signal?: AbortSignal) => {
    const response = await fetch(`${API_BASE_URL}/generate-test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ document_chunks: documentChunks }),
      signal,
    });
    if (!response.ok) throw new Error("Failed to generate test");
    return response.json();
  },
  getDailyQuote: async (signal?: AbortSignal) => {
    const response = await fetch(`${API_BASE_URL}/quote/daily`, { signal });
    if (!response.ok) throw new Error("Failed to fetch daily quote");
    return response.json();
  },
  
  getDocumentText: async (docName: string, signal?: AbortSignal) => {
    const response = await fetch(`${API_BASE_URL}/document-text/${encodeURIComponent(docName)}`, {
      signal
    });
    if (!response.ok) throw new Error("Failed to fetch document text");
    return response.json();
  },
  
  // --- NEW: Add summarizeDocument to apiService ---
  summarizeDocument: async (docName: string, signal?: AbortSignal) => {
    const response = await fetch(`${API_BASE_URL}/summarize-document/${encodeURIComponent(docName)}`, {
      signal
    });
    if (!response.ok) throw new Error("Failed to summarize document");
    return response.json(); // Returns { summary: "..." }
  },

  summarizeWithOpenRouter: async (text: string, signal?: AbortSignal) => {
    if (!OPENROUTER_API_KEY) {
    return "Error: OpenRouter API key not found. Make sure you have set REACT_APP_OPENROUTER_API_KEY in your .env file and have restarted the server.";
    }
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "mistralai/mistral-7b-instruct", // Or any other model you prefer
        messages: [
          { role: "user", content: `Provide a concise summary or definition for the following: "${text}"` }
        ]
      }),
      signal
    });
    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`OpenRouter API request failed: ${errorData.error?.message || 'Unknown error'}`);
    }
    const data = await response.json();
    return data.choices[0].message.content;
  },
};

// Components
// ... (CodeBlock component is unchanged) ...
const CodeBlock: React.FC<{
  node?: any;
  inline?: boolean;
  className?: string;
  children?: any;
}> = ({ node, inline, className, children, ...props }) => {
  const match = /language-(\w+)/.exec(className || '');
  const codeContent = String(children).replace(/\n$/, '');
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(codeContent)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(err => console.error('Failed to copy text: ', err));
  }, [codeContent]);

  return !inline && match ? (
    <div className="code-block-container">
      <div className="code-block-header">
        <span className="code-language">{match[1]}</span>
        <button onClick={handleCopy} className="copy-button">
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <pre className="code-block-content">
        <code>{codeContent}</code>
      </pre>
    </div>
  ) : (
    <code className={className} {...props}>
      {children}
    </code>
  );
};

const ChatMessage: React.FC<{
  message: Message;
  onAudioPlayback: (text: string) => void;
}> = ({ message, onAudioPlayback }) => (
  <div className={`chat-message ${message.sender} fade-in`}>
    <div className="chat-message-header">
      <strong className="chat-message-sender">
        {message.sender === "user" ? "You" : "Gen 2"}:
      </strong>
      {message.sender === "bot" && (
        <button
          className="add-to-notes-btn"
          title="Play audio"
          onClick={() => onAudioPlayback(message.text)}
        >
          🔊
        </button>
      )}
    </div>
    <ReactMarkdown components={{ code: CodeBlock }}>
      {message.text}
    </ReactMarkdown>
  </div>
);

// --- MODIFIED: DocumentItem now needs an onLoadContext prop ---
const DocumentItem: React.FC<{
  document: Document;
  onToggle: (docName: string) => void;
  onDelete: (docName: string) => void;
  onLoadContext: (docName: string) => void; // <-- NEW PROP
}> = ({ document, onToggle, onDelete, onLoadContext }) => (
  <div className="document-item">
    <label className="document-checkbox">
      <input
        type="checkbox"
        checked={document.active}
        onChange={() => onToggle(document.name)}
      />
      <span className="checkmark"></span>
      <span className="document-name">{document.name}</span>
    </label>
    <div className="document-item-actions">
      {document.active && ( // <-- Only show "Load" if active
        <button
          className="load-context-btn"
          title="Load context into chat"
          onClick={() => onLoadContext(document.name)}
        >
          Load
        </button>
      )}
      <span
        className="delete-icon"
        onClick={() => onDelete(document.name)}
      >
        ✕
      </span>
    </div>
  </div>
);

// --- Helper to create a new session ---
const createNewSession = (name: string): Session => {
  return {
    id: uuidv4(),
    name: name,
    messages: [],
    isLoading: false, // <-- ADDED default
  };
};

const App: React.FC = () => {
  // State
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isTakingCompulsoryAssessment, setIsTakingCompulsoryAssessment] = useState(false);
  
  // --- MODIFIED: Session-based state ---
  const [sessions, setSessions] = useState<Record<string, Session>>(() => {
    const savedSessions = localStorage.getItem('chatSessions');
    try {
      if (savedSessions) {
        // --- MODIFIED: Ensure isLoading property exists ---
        const parsed = JSON.parse(savedSessions);
        Object.values(parsed).forEach((session: any) => {
          if (session.isLoading === undefined) {
            session.isLoading = false;
          }
        });
        return parsed;
      }
    } catch (e) { console.error("Failed to parse sessions:", e); }
    // Default: Create one session
    const defaultSession = createNewSession("Chat 1");
    return { [defaultSession.id]: defaultSession };
  });

  const [activeSessionId, setActiveSessionId] = useState<string | null>(() => {
    const savedId = localStorage.getItem('activeSessionId');
    const savedSessions = localStorage.getItem('chatSessions');
    try {
      // Check if savedId exists and is a valid key in sessions
      if (savedId && savedSessions) {
        const parsedSessions = JSON.parse(savedSessions);
        if (parsedSessions[savedId]) {
          return savedId;
        }
      }
    } catch (e) { console.error("Failed to parse session ID:", e); }
    
    // Default: Find the first session ID from the loaded sessions
    try {
        const parsedSessions = savedSessions ? JSON.parse(savedSessions) : null;
        if(parsedSessions && Object.keys(parsedSessions).length > 0) {
            return Object.keys(parsedSessions)[0];
        }
    } catch(e) {}

    // Fallback: if localStorage is empty/corrupt, use the default from useState
    const defaultSessionId = Object.keys(sessions)[0];
    return defaultSessionId || null;
  });

  // --- Get messages and loading state for the *current* session ---
  const activeSession = useMemo(() => {
    return activeSessionId ? sessions[activeSessionId] : null;
  }, [sessions, activeSessionId]);

  const activeMessages = useMemo(() => {
    return activeSession?.messages || [];
  }, [activeSession]);

  const isCurrentSessionLoading = useMemo(() => {
    return activeSession?.isLoading || false;
  }, [activeSession]);
  
  const [input, setInput] = useState("");
  const chatBoxRef = useRef<HTMLDivElement>(null);
  // const [isLoading, setIsLoading] = useState(false); // <-- REMOVED global loading state
  const [currentView, setCurrentView] = useState<"chat" | "assessment" | "upload" | "documents" | "test" | "reports">("chat");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState<string[]>([]);

  // ... (assessmentResult, uploadMessage, documents states are unchanged) ...
  const [assessmentResult, setAssessmentResult] = useState<AssessmentResult | null>(() => {
    const saved = localStorage.getItem('assessmentResult');
    try {
      return saved ? JSON.parse(saved) : null;
    } catch (e) {
      console.error("Failed to parse assessment result:", e);
      return null;
    }
  });

  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);

  const ws = useRef<WebSocket | null>(null);
  const activeSessionIdRef = useRef(activeSessionId);
  const isClosingWs = useRef(false);


  // ... (Notes Panel, dailyQuote, Audio states are unchanged) ...
  const [isNotesPanelOpen, setIsNotesPanelOpen] = useState(false);
  const [notes, setNotes] = useState<Note[]>(() => {
    const savedNotes = localStorage.getItem('savedNotes');
    try {
      return savedNotes ? JSON.parse(savedNotes) : [];
    } catch (e) {
      console.error("Failed to parse saved notes:", e);
      localStorage.removeItem('savedNotes');
      return [];
    }
  });
  const [currentNote, setCurrentNote] = useState<Note | null>(null);
  const [dailyQuote, setDailyQuote] = useState<string | null>(null);
  
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isMainAudioPopupOpen, setIsMainAudioPopupOpen] = useState(false);
  const [docAudioLoading, setDocAudioLoading] = useState(false);


  const cleanedQuote = useMemo(() => {
    if (!dailyQuote) return null;
    return dailyQuote
      .replace(/\[\/?B_INST\]/g, "")
      .replace(/<\/?s[> ]*/g, "")
      .trim()
      .replace(/^"/, '')
      .replace(/"$/, '');
  }, [dailyQuote]);

  // Effects
  useEffect(() => {
    if (chatBoxRef.current) {
      chatBoxRef.current.scrollTop = chatBoxRef.current.scrollHeight;
    }
  }, [activeMessages, currentView]); 

  // --- MODIFIED: Save sessions and active ID to localStorage ---
  useEffect(() => {
    localStorage.setItem('chatSessions', JSON.stringify(sessions));
  }, [sessions]);

  useEffect(() => {
    if (activeSessionId) {
      localStorage.setItem('activeSessionId', activeSessionId);
      // --- MODIFIED: Update the ref ---
      activeSessionIdRef.current = activeSessionId;
    } else {
      // Handle case where no session is active (e.g., last one deleted)
      const firstSessionId = Object.keys(sessions)[0];
      if (firstSessionId) {
        setActiveSessionId(firstSessionId);
      }
    }
  }, [activeSessionId, sessions]);

  useEffect(() => {
    localStorage.setItem('savedNotes', JSON.stringify(notes));
  }, [notes]);

  // WebSocket Effect (Streaming RAG)
  useEffect(() => {
    if (!isAuthenticated || isTakingCompulsoryAssessment) return;

    isClosingWs.current = false;
    const connectWebSocket = () => {
      if (isClosingWs.current || (ws.current && ws.current.readyState === WebSocket.OPEN)) {
        return; 
      }
      ws.current = new WebSocket(`${WS_BASE_URL}/ws/chat`);
      
      ws.current.onopen = () => {
        console.log("WebSocket connected");
      };

      // --- MODIFIED: Message handler updates session-specific loading ---
      ws.current.onmessage = (event: MessageEvent) => {
        let data: { token: string; sessionId: string };
        try {
          data = JSON.parse(String(event.data));
        } catch (e) {
          console.error("Failed to parse WebSocket message:", event.data);
          return;
        }

        const { token: messageText, sessionId: messageSessionId } = data;

        // --- MODIFIED: Handle __END__ token per session ---
        if (messageText === "__END__") {
          setSessions(prev => {
            // Check if session still exists before trying to update loading state
            if (!prev[messageSessionId]) return prev; 
            return {
              ...prev,
              [messageSessionId]: {
                ...prev[messageSessionId],
                isLoading: false // Stop loading for this specific session
              }
            };
          });
          return;
        }

        // --- Update messages for the *correct* session ---
        setSessions(prev => {
          const currentSession = prev[messageSessionId];
          if (!currentSession) { 
            console.error("Msg for unknown session:", messageSessionId, ". Known sessions:", Object.keys(prev));
            return prev; 
          }

          const lastMessage = currentSession.messages[currentSession.messages.length - 1];
          let newMessages: Message[];

          if (lastMessage && lastMessage.sender === 'bot') {
            const updatedMessage: Message = { 
              ...lastMessage, 
              text: lastMessage.text + messageText 
            };
            newMessages = [
              ...currentSession.messages.slice(0, -1),
              updatedMessage
            ];
          } else {
            const newBotMessage: Message = { 
              sender: 'bot', 
              text: messageText 
            };
            newMessages = [...currentSession.messages, newBotMessage];
          }

          return {
            ...prev,
            [messageSessionId]: {
              ...currentSession,
              messages: newMessages
              // isLoading state is handled by the __END__ token
            }
          };
        });
      };
      // --- End of modified message handler ---

      ws.current.onclose = () => {
        console.log("WebSocket disconnected.");
        if (!isClosingWs.current) {
          console.log("Attempting to reconnect...");
          setTimeout(connectWebSocket, 1000);
        }
      };

      // --- MODIFIED: Error handler updates session-specific loading ---
      ws.current.onerror = (error) => {
        console.error("WebSocket error:", error);
        
        const currentActiveId = activeSessionIdRef.current; // Use ref

        if (currentActiveId) {
          setSessions(prev => {
            const currentSession = prev[currentActiveId];
            if (!currentSession) return prev;
            
            const lastMessageText = currentSession.messages[currentSession.messages.length -1]?.text;
            let newMessages = currentSession.messages;
            if (lastMessageText !== "Error connecting to chat.") {
              newMessages = [...currentSession.messages, { sender: "bot", text: "Error connecting to chat." }];
            }

            return {
              ...prev,
              [currentActiveId]: { 
                ...currentSession,
                messages: newMessages,
                isLoading: false // <-- Stop loading on error
              }
            };
          });
        }
      };
    };

    connectWebSocket();

    // Cleanup function
    return () => {
      isClosingWs.current = true;
      if (ws.current) {
        ws.current.close(); 
      }
      ws.current = null;
      window.speechSynthesis.cancel();
    };
  }, [isAuthenticated, isTakingCompulsoryAssessment]); 

  useEffect(() => {
    if (!isAuthenticated) return; 

    const controller = new AbortController();

    const fetchInitialData = async () => {
      // Fetch documents
      try {
        const data = await apiService.getDocuments(controller.signal);
        setDocuments(data.documents.map((name: string) => ({ name, active: true })));
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        console.error("Error fetching documents:", error);
      } 

      // Fetch daily quote
      try {
        const today = new Date().toDateString();
        const lastFetchInfo = localStorage.getItem('dailyQuoteInfo');
        if (lastFetchInfo) {
          try {
            const { date, quote } = JSON.parse(lastFetchInfo);
            if (date === today && quote) {
              setDailyQuote(quote);
              return; 
            }
          } catch (e) {
            console.error("Failed to parse daily quote info:", e);
            localStorage.removeItem('dailyQuoteInfo');
          }
        }
        const data = await apiService.getDailyQuote(controller.signal);
        if (data && data.quote) {
           setDailyQuote(data.quote);
           localStorage.setItem('dailyQuoteInfo', JSON.stringify({ date: today, quote: data.quote }));
        }
      } catch (error) {
         if (!(error instanceof DOMException && error.name === 'AbortError')) {
          console.error("Error fetching daily quote:", error);
          setDailyQuote("The best way to predict the future is to create it.");
        }
      }
    };

    fetchInitialData();

    return () => {
      controller.abort();
    };
  }, [isAuthenticated]);

  // Handlers
  const handleLogin = () => {
    setIsAuthenticated(true);
    try {
      const storedResult = localStorage.getItem('assessmentResult');
      if (storedResult) {
          setAssessmentResult(JSON.parse(storedResult));
          setIsTakingCompulsoryAssessment(false);
          setCurrentView("chat");
      } else {
          setIsTakingCompulsoryAssessment(true);
          startAssessment();
      }
    } catch(e) {
        console.error("Failed to parse assessment result on login:", e);
        localStorage.removeItem('assessmentResult');
        setIsTakingCompulsoryAssessment(true);
        startAssessment();
    }
  };

  const getLearnerIcon = (style: string) => {
    switch (style.toLowerCase()) {
        case 'pictorial': return '👁️';
        case 'vocal': return '👂';
        case 'kinesthetic': return '🖐️';
        case 'memorizer': return '🧠';
        default: return null;
    }
  };

  const handleDocumentToggle = (docName: string) => {
    setDocuments(prevDocs =>
      prevDocs.map(doc =>
        doc.name === docName ? { ...doc, active: !doc.active } : doc
      )
    );
  };
  const handleDocumentDelete = async (docName: string) => {
    try {
      const controller = new AbortController();
      await apiService.deleteDocument(docName, controller.signal);
      setDocuments(prevDocs => prevDocs.filter(doc => doc.name !== docName));
    } catch (error) {
      console.error("Error deleting document:", error);
    }
  };

  // --- MODIFIED: Handler to Load Document FULL TEXT ---
  const handleLoadContext = async (docName: string) => {
    if (!activeSessionId) return;
    // setIsLoading(true); // <-- REMOVED global loading set
    
    // --- ADDED: Set session-specific loading ---
    setSessions(prev => ({
        ...prev,
        [activeSessionId]: { ...prev[activeSessionId], isLoading: true }
    }));
    
    // Add a temporary loading message to the chat
    const loadingMessage: Message = { sender: "bot", text: `*Loading context from ${docName}...*` };
    setSessions(prev => ({
      ...prev,
      [activeSessionId]: {
        ...prev[activeSessionId],
        messages: [...prev[activeSessionId].messages, loadingMessage]
      }
    }));

    try {
      const controller = new AbortController();
      const data = await apiService.getDocumentText(docName, controller.signal);
      
      const contextMessage: Message = {
        sender: "bot", 
        text: `**Context loaded from ${docName}:**\n\n${data.content}`
      };

      // Replace the loading message with the real summary
      setSessions(prev => {
        const currentMessages = prev[activeSessionId].messages;
        const newMessages = currentMessages.filter(msg => msg.text !== loadingMessage.text); // Remove loading msg
        return {
          ...prev,
          [activeSessionId]: {
            ...prev[activeSessionId],
            messages: [...newMessages, contextMessage]
          }
        };
      });

    } catch (error) {
      console.error("Error loading context:", error);
      const errorMessage: Message = { sender: "bot", text: `*Failed to load context from ${docName}.*` };
      // Replace the loading message with an error
      setSessions(prev => {
        const currentMessages = prev[activeSessionId].messages;
        const newMessages = currentMessages.filter(msg => msg.text !== loadingMessage.text); // Remove loading msg
        return {
          ...prev,
          [activeSessionId]: {
            ...prev[activeSessionId],
            messages: [...newMessages, errorMessage]
          }
        };
      });
    } finally {
      // setIsLoading(false); // <-- REMOVED global loading set
      // --- ADDED: Set session-specific loading ---
      setSessions(prev => ({
          ...prev,
          [activeSessionId]: { ...prev[activeSessionId], isLoading: false }
      }));
    }
  };

  // --- MODIFIED: sendMessage uses session-specific loading ---
  const sendMessage = async () => {
    // --- Use isCurrentSessionLoading ---
    if (!input.trim() || isCurrentSessionLoading || !activeSessionId) return; 
    
    if (!ws.current || ws.current.readyState !== WebSocket.OPEN) {
      setSessions(prev => ({
        ...prev,
        [activeSessionId]: {
          ...prev[activeSessionId],
          messages: [...prev[activeSessionId].messages, { sender: "bot", text: "Chat is not connected. Please wait..." }]
        }
      }));
      return;
    }

    const userMessage: Message = { sender: "user", text: input };
    
    // --- Add messages and set loading for *active* session ---
    setSessions(prev => ({
      ...prev,
      [activeSessionId]: {
        ...prev[activeSessionId],
        messages: [...prev[activeSessionId].messages, userMessage, { sender: "bot", text: "" }],
        isLoading: true // <-- Set loading HERE
      }
    }));
    // setIsLoading(true); // <-- REMOVED global loading set

    const activeDocs = documents.filter(d => d.active).map(d => d.name);
    
    const messagePayload = {
      question: input,
      active_documents: activeDocs,
      sessionId: activeSessionId 
    };
    
    ws.current.send(JSON.stringify(messagePayload));
    setInput("");
  };

  // --- NEW: Handlers for managing sessions ---
  const handleAddNewSession = () => {
    const newSession = createNewSession(`Chat ${Object.keys(sessions).length + 1}`);
    setSessions(prev => ({
      ...prev,
      [newSession.id]: newSession
    }));
    setActiveSessionId(newSession.id);
    setCurrentView("chat"); // Switch to chat view
  };

  const handleSwitchSession = (sessionId: string) => {
    if (sessions[sessionId]) {
      setActiveSessionId(sessionId);
    }
  };

  // --- MODIFIED: startAssessment uses global loading (it's modal) ---
  const [isAssessmentLoading, setIsAssessmentLoading] = useState(false);
  const startAssessment = async () => {
    setIsAssessmentLoading(true); // <-- Use separate loading state
    setSelectedAnswers([]);
    setCurrentQuestionIndex(0);

    try {
      const controller = new AbortController();
      const data = await apiService.getQuestions(controller.signal);
      setQuestions(data.questions);
      setCurrentView("assessment");
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        console.error("Error fetching questions:", error);
        // Add error to active session (if exists)
        if (activeSessionId) {
          setSessions(prev => ({
            ...prev,
            [activeSessionId]: {
              ...prev[activeSessionId],
              messages: [...prev[activeSessionId].messages, { sender: "bot", text: "Could not fetch assessment questions." }]
            }
          }));
        }
      }
    } finally {
      setIsAssessmentLoading(false); // <-- Use separate loading state
    }
  };

  // ... (handleAnswerSelection, goToNextQuestion are unchanged) ...
  const handleAnswerSelection = (answerType: string) => {
    setSelectedAnswers(prev => {
      const newAnswers = [...prev];
      newAnswers[currentQuestionIndex] = answerType;
      return newAnswers;
    });
  };

  const goToNextQuestion = () => {
    if (currentQuestionIndex < questions.length - 1) {
      setCurrentQuestionIndex(prev => prev + 1);
    } else {
      submitAssessment();
    }
  };

  // --- MODIFIED: submitAssessment uses global loading ---
  const submitAssessment = async () => {
    setIsAssessmentLoading(true); // <-- Use separate loading state
    try {
      const controller = new AbortController();
      const data = await apiService.evaluateAssessment(selectedAnswers, controller.signal);
      setAssessmentResult(data);
      localStorage.setItem('assessmentResult', JSON.stringify(data));
      
      if (isTakingCompulsoryAssessment) {
          setIsTakingCompulsoryAssessment(false);
      }
      
      // Add result to active session (if exists)
      if (activeSessionId) {
        const assessmentMessage: Message = {
          sender: "bot",
          text: `Assessment complete! Your learning style is: **${data.learning_style}**. ${data.description}`
        };
        setSessions(prev => ({
          ...prev,
          [activeSessionId]: {
            ...prev[activeSessionId],
            messages: [...prev[activeSessionId].messages, assessmentMessage]
          }
        }));
      }
      setCurrentView("chat");
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        console.error("Error submitting assessment:", error);
        // Add error to active session (if exists)
        if (activeSessionId) {
          setSessions(prev => ({
            ...prev,
            [activeSessionId]: {
              ...prev[activeSessionId],
              messages: [...prev[activeSessionId].messages, { sender: "bot", text: "Error submitting assessment." }]
            }
          }));
        }
      }
    } finally {
      setIsAssessmentLoading(false); // <-- Use separate loading state
    }
  };

  // --- MODIFIED: handleFileUpload uses global loading ---
  const [isUploadLoading, setIsUploadLoading] = useState(false);
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      setUploadMessage("No file selected.");
      return;
    }

    if (file.type !== "application/pdf") {
      setUploadMessage("Only PDF files are allowed.");
      return;
    }

    setUploadMessage("Uploading and updating knowledge base...");
    setIsUploadLoading(true); // <-- Use separate loading state

    try {
      const controller = new AbortController();
      await apiService.uploadDocument(file, controller.signal);
      setUploadMessage("File uploaded successfully!");
      // Refetch documents
      const data = await apiService.getDocuments(); 
      setDocuments(data.documents.map((name: string) => ({ name, active: true })));
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        console.error("Upload error:", error);
        setUploadMessage("Error uploading file to server.");
      }
    } finally {
      setIsUploadLoading(false); // <-- Use separate loading state
      if (event.target) {
        event.target.value = ''; // Clear file input
      }
    }
  };

  // --- Notes Panel Handlers ---
  // ... (All Notes Panel handlers are unchanged) ...
  const handleAddTextToNotes = (text: string) => {
    const newNote: Note = {
      id: Date.now().toString(),
      content: `From Chat (selection):\n${text}`
    };
    setNotes(prevNotes => [newNote, ...prevNotes]);
    alert("Note added!");
  };

  const handleChatSelection = () => {
    // --- Use isCurrentSessionLoading ---
    if (isCurrentSessionLoading) return; 
    const selectedText = window.getSelection()?.toString().trim();
    if (selectedText) {
      let parent = window.getSelection()?.anchorNode?.parentElement;
      let inChat = false;
      while (parent) {
        if (parent.classList.contains('chat-box')) {
          inChat = true;
          break;
        }
        parent = parent.parentElement;
      }
      if (inChat) {
        if (window.confirm(`Add this to notes?\n\n"${selectedText}"`)) {
          handleAddTextToNotes(selectedText);
        }
      }
    }
  };

  const openNotesPanel = () => {
    setIsNotesPanelOpen(true);
    setCurrentNote(null); 
  };

  const closeNotesPanel = () => {
    setIsNotesPanelOpen(false);
    setCurrentNote(null);
  };

  const handleSelectNote = (note: Note) => {
    setCurrentNote(note);
  };

  const handleAddNewNote = () => {
    const newNote: Note = { id: Date.now().toString(), content: "New Note..." };
    setNotes(prevNotes => [newNote, ...prevNotes]);
    setCurrentNote(newNote);
  };
  
  const handleSaveNote = (id: string, content: string) => {
    setNotes(prevNotes => 
      prevNotes.map(note => note.id === id ? { ...note, content } : note)
    );
    setCurrentNote(null); 
    alert("Note saved!");
  };
  
  const handleDeleteNote = (id: string) => {
    if (window.confirm("Are you sure you want to delete this note?")) {
      setNotes(prevNotes => prevNotes.filter(note => note.id !== id));
      setCurrentNote(null); 
    }
  };

  // --- Audio Handlers ---
  // ... (All Audio Handlers are unchanged) ...
  const handleAudioOverview = () => {
    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      setDocAudioLoading(false);
    } else {
      setIsMainAudioPopupOpen(true);
    }
  };

  const playMessageAudio = (text: string) => {
    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      return; 
    }
    
    setIsSpeaking(true);
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.onend = () => {
      setIsSpeaking(false);
    };
    utterance.onerror = () => {
      setIsSpeaking(false);
    };
    window.speechSynthesis.speak(utterance);
  };
  
  // --- MODIFIED: This function now plays a SUMMARY ---
  const playDocumentAudio = async (docName: string) => {
    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
    }

    setDocAudioLoading(true);
    setIsSpeaking(true);
    try {
      // --- MODIFIED: Call summarizeDocument ---
      const data = await apiService.summarizeDocument(docName);
      // --- MODIFIED: Use data.summary ---
      const utterance = new SpeechSynthesisUtterance(data.summary);
      
      utterance.onend = () => {
        setDocAudioLoading(false);
        setIsMainAudioPopupOpen(false);
        setIsSpeaking(false);
      };
      utterance.onerror = () => {
        setDocAudioLoading(false);
        setIsSpeaking(false);
      };

      window.speechSynthesis.speak(utterance);
    } catch (error) {
      console.error("Error playing document audio:", error);
      setDocAudioLoading(false);
      setIsSpeaking(false);
    }
  };

  // --- Render Functions ---

  // --- MODIFIED: renderChatbot uses session-specific loading ---
  const renderChatbot = () => (
    <div className="chat-content-container">
      <div 
        className="chat-box" 
        ref={chatBoxRef} 
        onMouseUp={handleChatSelection}
      >
        {activeMessages.map((msg, idx) => (
          <ChatMessage 
            key={idx} 
            message={msg}
            onAudioPlayback={playMessageAudio}
          />
        ))}
        {/* --- MODIFIED: Show indicator based on session loading state --- */}
        {isCurrentSessionLoading && activeMessages[activeMessages.length - 1]?.text === "" && <LoadingIndicator />}
      </div>
      <div className="chat-input-area">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendMessage()}
          placeholder="Type your message..."
          className="chat-input-field"
          // --- MODIFIED: Disable based on session loading state ---
          disabled={isCurrentSessionLoading} 
        />
        <button 
          onClick={sendMessage} 
          className="send-button" 
          // --- MODIFIED: Disable based on session loading state ---
          disabled={isCurrentSessionLoading} 
        >
          Send
        </button>
      </div>
    </div>
  );

  // --- MODIFIED: renderAssessment uses its own loading state ---
  const renderAssessment = () => (
    <div className="assessment-container">
      {isAssessmentLoading ? ( // <-- Use isAssessmentLoading
        <div className="loading-message">
          <LoadingIndicator />
          <p>Loading questions...</p>
        </div>
      ) : questions.length > 0 ? (
        <div className="assessment-quiz-section">
           { !localStorage.getItem('assessmentResult') && (
                <div style={{textAlign: 'center', marginBottom: '20px', padding: '10px', background: '#eef2ff', borderRadius: '8px'}}>
                    <p style={{margin: 0, fontWeight: 500, color: 'var(--primary-color)'}}>Welcome! Please complete this one-time assessment to personalize your learning experience.</p>
                </div>
            )}
          <p className="assessment-question">
            {currentQuestionIndex + 1}. {questions[currentQuestionIndex]?.question}
          </p>
          <div className="assessment-options">
            {questions[currentQuestionIndex]?.options.map((option, optIdx) => (
              <div
                key={optIdx}
                className={`assessment-option ${
                  selectedAnswers[currentQuestionIndex] === option.type ? 'selected' : ''
                }`}
                onClick={() => handleAnswerSelection(option.type)}
              >
                {option.text}
              </div>
            ))}
          </div>
          <div className="assessment-navigation">
            <button
              onClick={() => setCurrentQuestionIndex(prev => prev - 1)}
              disabled={currentQuestionIndex === 0 || isAssessmentLoading} // <-- Use isAssessmentLoading
            >
              Previous
            </button>
            <button
              onClick={goToNextQuestion}
              disabled={selectedAnswers[currentQuestionIndex] === undefined || isAssessmentLoading} // <-- Use isAssessmentLoading
            >
              {currentQuestionIndex === questions.length - 1
                ? "Submit Assessment"
                : "Next Question"}
            </button>
          </div>
        </div>
      ) : (
        <div style={{ textAlign: 'center', color: '#2C3E50' }}>
          <p>No assessment questions available. Please try again later.</p>
        </div>
      )}
    </div>
  );

  // --- MODIFIED: renderDocuments uses its own loading state for upload ---
  const renderDocuments = () => (
    <div className="documents-container">
      {/* --- Session Management UI --- */}
      <div className="session-manager">
        <div className="documents-panel-header" style={{ marginBottom: '10px' }}>
          <h3>Chat Sessions</h3>
          <button 
            onClick={handleAddNewSession} 
            className="upload-button-label small-button"
            title="Create a new chat"
          >
            <span className="plus-icon">+</span> New
          </button>
        </div>
        <select 
          className="session-select"
          value={activeSessionId || ""} 
          onChange={(e) => handleSwitchSession(e.target.value)}
        >
          {Object.values(sessions).map(session => (
            <option key={session.id} value={session.id}>
              {session.name}
            </option>
          ))}
        </select>
      </div>

      {/* --- Document UI --- */}
      <div className="documents-panel-header" style={{ marginTop: '20px' }}>
        <h3>Sources</h3>
        <div className="documents-actions">
          <label htmlFor="pdf-upload" className={`upload-button-label small-button ${isUploadLoading ? 'disabled' : ''}`}>
            <span className="plus-icon">+</span> Add
          </label>
          <input
            type="file"
            id="pdf-upload"
            accept=".pdf"
            onChange={handleFileUpload}
            disabled={isUploadLoading} // <-- Use isUploadLoading
            style={{ display: 'none' }}
          />
        </div>
      </div>
      {/* --- Show upload status --- */}
      {isUploadLoading && <div className="upload-status-message">Uploading...</div>}
      {uploadMessage && !isUploadLoading && <div className="upload-status-message">{uploadMessage}</div>}

      {/* --- Document List --- */}
      {documents.length === 0 && !isUploadLoading ? ( // <-- Check isUploadLoading
        <div className="placeholder-content">
          <div className="icon">📄</div>
          <p>Saved sources will appear here.</p>
          {/* ... placeholder text ... */}
        </div>
      ) : (
        <div className="document-list">
          {documents.map(doc => (
            <DocumentItem
              key={doc.name}
              document={doc}
              onToggle={handleDocumentToggle}
              onDelete={handleDocumentDelete}
              onLoadContext={handleLoadContext} 
            />
          ))}
        </div>
      )}
    </div>
  );

  // ... (renderStudio is unchanged) ...
  const renderStudio = () => {
    return (
        <div className="studio-container">
          <div className="studio-header">
            <div className="upper">Studio</div>
          </div>
          
          <div className="studio-layout-container">
            <div className="studio-top-row">
              <div 
                className="studio-output-item" 
                onClick={handleAudioOverview}
              >
                <div className="output-icon">{isSpeaking ? '⏹️' : '🔊'}</div>
                <p>{isSpeaking ? 'Stop Audio' : 'Audio Overview'}</p>
              </div>
              <div className="studio-output-item" onClick={openNotesPanel}>
                <div className="output-icon">📝</div>
                <p>Notes</p>
              </div>
            </div>
            
            <div className="studio-bottom-row">
              <div className="studio-output-item" onClick={() => setCurrentView('reports')}>
                <div className="output-icon">📊</div>
                <p>Reports</p>
              </div>
            </div>
          </div>

          <div className="studio-footer">
            {cleanedQuote ? (
              <div className="daily-quote-container">
                <p className="quote-text">"{cleanedQuote}"</p>
                <p className="quote-label">Quote of the Day</p>
              </div>
            ) : (
              <p className="small-text">
                Studio output will be saved here.
              </p>
            )}
          </div>
        </div>
    );
  }

  // ... (renderNotesPanel, NoteList, NoteEditor are unchanged) ...
  const renderNotesPanel = () => (
    <div className="notes-panel-overlay">
      <div className="notes-panel">
        <div className="notes-panel-header">
          <h3>My Notes</h3>
          <button className="notes-close-btn" onClick={closeNotesPanel}>✕</button>
        </div>
        {currentNote ? (
          <NoteEditor
            note={currentNote}
            onSave={handleSaveNote}
            onDelete={handleDeleteNote}
            onBack={() => setCurrentNote(null)}
          />
        ) : (
          <NoteList
            notes={notes}
            onSelectNote={handleSelectNote}
            onAddNewNote={handleAddNewNote}
          />
        )}
      </div>
    </div>
  );
  
  const NoteList: React.FC<{
    notes: Note[];
    onSelectNote: (note: Note) => void;
    onAddNewNote: () => void;
  }> = ({ notes, onSelectNote, onAddNewNote }) => {
    return (
      <div className="notes-list-container">
        <button className="notes-panel-btn save" onClick={onAddNewNote} style={{marginBottom: '15px'}}>
          + Create New Note
        </button>
        <div className="notes-list">
          {notes.length === 0 ? (
            <p style={{textAlign: 'center', color: 'var(--text-light)'}}>No notes saved. Select text from chat or create a new note!</p>
          ) : (
            notes.map(note => (
              <div key={note.id} className="note-item" onClick={() => onSelectNote(note)}>
                <p className="note-snippet">
                  {note.content.substring(0, 100) + (note.content.length > 100 ? "..." : "")}
                </p>
              </div>
            ))
          )}
        </div>
      </div>
    );
  };
  
  const NoteEditor: React.FC<{
    note: Note;
    onSave: (id: string, content: string) => void;
    onDelete: (id: string) => void;
    onBack: () => void;
  }> = ({ note, onSave, onDelete, onBack }) => {
    const [editorText, setEditorText] = useState(note.content);
    const [highlighted, setHighlighted] = useState("");
    const [summary, setSummary] = useState("");
    const [isSummarizing, setIsSummarizing] = useState(false);
    const editorTextAreaRef = useRef<HTMLTextAreaElement>(null);
  
    const handleHighlight = () => {
      const textarea = editorTextAreaRef.current;
      if (textarea) {
        const selectedText = textarea.value.substring(textarea.selectionStart, textarea.selectionEnd).trim();
        setHighlighted(selectedText);
      }
    };
  
    const handleSummarize = async () => {
      if (!highlighted) return;
      setIsSummarizing(true);
      setSummary("");
      try {
        const controller = new AbortController();
        const summaryText = await apiService.summarizeWithOpenRouter(highlighted, controller.signal);
        setSummary(summaryText);
      } catch (error) {
        console.error("Error summarizing text:", error);
        setSummary(`Error: ${error instanceof Error ? error.message : "Failed to get summary."}`);
      } finally {
        setIsSummarizing(false);
      }
    };
  
    return (
      <>
        <div className="notes-panel-content">
          <textarea
            ref={editorTextAreaRef}
            className="notes-textarea"
            value={editorText}
            onChange={(e) => setEditorText(e.target.value)}
            onSelect={handleHighlight}
            placeholder="Type your notes here..."
          />
          {highlighted && (
            <div className="highlight-summary-section">
              <p className="highlighted-text-info">
                Selected: <strong>"{highlighted}"</strong>
              </p>
              <button
                className="notes-panel-btn summarize"
                onClick={handleSummarize}
                disabled={isSummarizing}
              >
                {isSummarizing ? "Summarizing..." : "Summarize"}
              </button>
            </div>
          )}
          {summary && (
            <div className="summary-result-box">
              <ReactMarkdown>{summary}</ReactMarkdown>
            </div>
          )}
        </div>
        <div className="notes-panel-actions" style={{justifyContent: 'space-between'}}>
          <div>
            <button className="notes-panel-btn" onClick={onBack} style={{background: '#eee', color: '#333'}}>Back</button>
            <button className="notes-panel-btn" onClick={() => onDelete(note.id)} style={{background: '#f72585', color: 'white'}}>Delete</button>
          </div>
          <button className="notes-panel-btn save" onClick={() => onSave(note.id, editorText)}>Save Note</button>
        </div>
      </>
    );
  };

  // ... (renderMainAudioPopup is unchanged) ...
  const renderMainAudioPopup = () => {
    const activeDocs = documents.filter(d => d.active);

    return (
      <div className="notes-panel-overlay">
          <div className="notes-panel" style={{height: 'auto', maxHeight: '70vh'}}>
              <div className="notes-panel-header">
                  <h3>Play Audio From Document</h3>
                  <button className="notes-close-btn" onClick={() => {
                    window.speechSynthesis.cancel();
                    setDocAudioLoading(false);
                    setIsMainAudioPopupOpen(false);
                    setIsSpeaking(false);
                  }}>✕</button>
              </div>
              <div className="notes-panel-content">
                {docAudioLoading ? (
                  <div className="loading-message">
                    <LoadingIndicator />
                    <p>Loading audio...</p>
                  </div>
                ) : activeDocs.length > 0 ? (
                  <div className="doc-audio-list">
                    <p>Select an active document to play:</p>
                    {activeDocs.map(doc => (
                      <button 
                        key={doc.name} 
                        className="doc-audio-button"
                        onClick={() => playDocumentAudio(doc.name)}
                        disabled={isSpeaking}
                      >
                        {doc.name}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p>No active documents found. Activate documents in the 'Sources' panel.</p>
                )}
              </div>
          </div>
      </div>
    );
  };

  const activeDocsForTest = useMemo(() =>
    documents.filter(doc => doc.active).map(doc => doc.name),
    [documents]
  );

  const renderMainContent = () => {
    switch (currentView) {
      case 'assessment':
        return renderAssessment();
      case 'documents':
        // This view is now handled by the left panel
        // We default to showing the chat for the active session
        return renderChatbot(); 
      case 'test':
        return <TestFeature activeDocuments={activeDocsForTest} />;
      case 'reports':
        return <ReportsFeature assessmentResult={assessmentResult} />;
      default:
        return renderChatbot();
    }
  };

  const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

  // JSX
  return (
    <>
      <style>{`
        /* --- FONT UPDATE: Import Montserrat from Google Fonts --- */
        @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&display=swap');

        :root {
          --primary-color: #4361ee;
          --secondary-color: #3f37c9;
          --accent-color: #4895ef;
          --light-color: #f8f9fa;
          --dark-color: #212529;
          --success-color: #4cc9f0;
          --warning-color: #f8961e;
          --danger-color: #f72585;
          --text-color: #2b2d42;
          --text-light: #8d99ae;
          --bg-gradient: linear-gradient(135deg, #4361ee 0%, #3f37c9 100%);
        }

        body {
          margin: 0;
          /* --- FONT UPDATE: Set Montserrat as the primary font --- */
          font-family: 'Montserrat', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
          background-color: #f5f7ff;
          color: var(--text-color);
          display: flex;
          justify-content: center;
          align-items: center;
          min-height: 100vh;
          padding: 0;
          box-sizing: border-box;
        }

        .main-app-container {
          width: 100vw;
          height: 100vh;
          max-width: none;
          min-width: auto;
          display: flex;
          flex-direction: column;
          background: #ffffff;
          border-radius: 0;
          box-shadow: none;
          overflow: hidden;
          transition: all 0.3s ease;
        }

        .main-app-container:hover {
          box-shadow: 0 15px 50px rgba(67, 97, 238, 0.2);
        }

        .top-nav {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 15px 30px;
          background: var(--bg-gradient);
          color: white;
          box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1);
          flex-shrink: 0;
          position: relative;
          z-index: 10;
        }

        .top-nav .app-logo {
          font-weight: 700;
          font-size: 1.6em;
          letter-spacing: 1px;
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .learner-icon {
            font-size: 0.8em;
            background-color: rgba(255, 255, 255, 0.2);
            padding: 4px 6px;
            border-radius: 8px;
            line-height: 1;
        }

        .nav-buttons {
          display: flex;
          gap: 15px;
        }

        .nav-buttons button {
          padding: 10px 20px;
          background: rgba(255, 255, 255, 0.1);
          border: 2px solid rgba(255, 255, 255, 0.2);
          color: white;
          font-weight: 600;
          border-radius: 25px;
          cursor: pointer;
          transition: all 0.3s ease;
          font-family: inherit; /* Ensure buttons use the new font */
        }

        .nav-buttons button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
            transform: none;
            box-shadow: none;
        }

        .nav-buttons button:hover:not(:disabled),
        .nav-buttons button.active {
          background-color: rgba(255, 255, 255, 0.2);
          transform: translateY(-2px);
          box-shadow: 0 4px 10px rgba(0, 0, 0, 0.2);
        }

        .main-content-grid {
          flex: 1;
          display: grid;
          grid-template-columns: 1fr 2fr 1fr;
          gap: 20px;
          padding: 20px;
          background-color: #f5f7ff;
          min-height: 0;
          overflow: hidden;
          transition: opacity 0.3s ease-in-out;
        }

        .panel {
          background-color: #ffffff;
          border-radius: 16px;
          box-shadow: 0 5px 20px rgba(67, 97, 238, 0.08);
          display: flex;
          flex-direction: column;
          padding: 20px;
          transition: all 0.3s ease;
          overflow-y: auto;
          min-height: 0;
        }

        .panel:nth-child(2) { /* Target middle panel specifically */
          grid-column: 2;
          padding: 25px;
        }

        .panel:hover {
          box-shadow: 0 8px 30px rgba(67, 97, 238, 0.1);
        }

        .panel-header {
          font-size: 1.4em;
          font-weight: 600;
          color: var(--primary-color);
          margin-bottom: 20px;
          padding-bottom: 15px;
          border-bottom: 2px solid rgba(67, 97, 238, 0.1);
          flex-shrink: 0;
        }

        .panel-content {
          flex: 1;
          display: flex;
          flex-direction: column;
          min-height: 0;
          overflow-y: auto;
        }

        .chat-content-container {
          display: flex;
          flex-direction: column;
          flex: 1;
          min-height: 0;
        }

        .chat-box {
          flex: 1;
          background: linear-gradient(to bottom, #f8f9ff, #eef0ff);
          padding: 20px;
          overflow-y: auto;
          border-radius: 12px;
          display: flex;
          flex-direction: column;
          gap: 15px;
          scroll-behavior: smooth;
          min-height: 0;
        }

        /* Custom scrollbar */
        .chat-box::-webkit-scrollbar,
        .document-list::-webkit-scrollbar,
        .test-question-scroll-area::-webkit-scrollbar,
        .test-feature-container::-webkit-scrollbar,
        .reports-container::-webkit-scrollbar,
        .panel::-webkit-scrollbar {
          width: 8px;
        }

        .chat-box::-webkit-scrollbar-track,
        .document-list::-webkit-scrollbar-track,
        .test-question-scroll-area::-webkit-scrollbar-track,
        .test-feature-container::-webkit-scrollbar-track,
        .reports-container::-webkit-scrollbar-track,
        .panel::-webkit-scrollbar-track {
          background: rgba(67, 97, 238, 0.05);
          border-radius: 10px;
        }

        .chat-box::-webkit-scrollbar-thumb,
        .document-list::-webkit-scrollbar-thumb,
        .test-question-scroll-area::-webkit-scrollbar-thumb,
        .test-feature-container::-webkit-scrollbar-thumb,
        .reports-container::-webkit-scrollbar-thumb,
        .panel::-webkit-scrollbar-thumb {
          background: rgba(67, 97, 238, 0.2);
          border-radius: 10px;
        }

        .chat-box::-webkit-scrollbar-thumb:hover,
        .document-list::-webkit-scrollbar-thumb:hover,
        .test-question-scroll-area::-webkit-scrollbar-thumb:hover,
        .test-feature-container::-webkit-scrollbar-thumb:hover,
        .reports-container::-webkit-scrollbar-thumb:hover,
        .panel::-webkit-scrollbar-thumb:hover {
          background: rgba(67, 97, 238, 0.3);
        }

        .chat-input-area {
          display: flex;
          gap: 10px;
          margin-top: 20px;
          align-items: center;
          flex-shrink: 0;
        }

        .chat-input-field {
          flex-grow: 1;
          padding: 14px 20px;
          border-radius: 25px;
          border: 2px solid rgba(67, 97, 238, 0.2);
          font-size: 1em;
          outline: none;
          transition: all 0.3s ease;
          background: #ffffff;
          color: var(--text-color);
          font-family: inherit;
        }

        .chat-input-field:focus {
          border-color: var(--primary-color);
          box-shadow: 0 0 0 3px rgba(67, 97, 238, 0.2);
        }

        .send-button {
          background: var(--primary-color);
          color: white;
          border: none;
          padding: 14px 25px;
          border-radius: 25px;
          cursor: pointer;
          font-weight: 600;
          transition: all 0.3s ease;
          box-shadow: 0 4px 10px rgba(67, 97, 238, 0.3);
          font-family: inherit;
        }

        .send-button:hover {
          background: var(--secondary-color);
          transform: translateY(-2px);
          box-shadow: 0 6px 15px rgba(67, 97, 238, 0.4);
        }

        .send-button:disabled {
          background: var(--text-light);
          cursor: not-allowed;
          transform: none;
          box-shadow: none;
        }

        .chat-message {
          display: flex;
          flex-direction: column;
          padding: 25px 20px;
          border-radius: 18px;
          max-width: 95%;
          word-wrap: break-word;
          box-shadow: 0 3px 10px rgba(0, 0, 0, 0.05);
          transition: all 0.4s ease-out;
          animation-duration: 0.4s;
          animation-fill-mode: both;
        }
        
        .chat-message-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 5px;
        }
        
        .add-to-notes-btn {
          background: none;
          border: none;
          cursor: pointer;
          font-size: 1.2em;
          opacity: 0.5;
          transition: opacity 0.2s;
        }
        
        .chat-message.bot:hover .add-to-notes-btn {
          opacity: 1;
        }

        .chat-message.user {
          background-color: #e0e7ff;
          color: var(--text-color);
          margin-left: auto;
          align-items: stretch;
          text-align: right;
          border-bottom-right-radius: 5px;
          animation-name: slideInRight;
        }
        .chat-message.user .chat-message-header {
          justify-content: flex-end;
        }

        .chat-message.bot {
          background-color: #f0f9ff;
          color: var(--text-color);
          margin-right: auto;
          align-items: stretch;
          text-align: left;
          border-bottom-left-radius: 5px;
          animation-name: slideInLeft;
        }

        .chat-message-sender {
          font-weight: 700;
          letter-spacing: 0.5px;
        }

        .chat-message.user .chat-message-sender {
          color: var(--primary-color);
        }

        .chat-message.bot .chat-message-sender {
          color: var(--accent-color);
        }

        /* --- Document/Source Panel Styles --- */
        .documents-container {
          display: flex;
          flex-direction: column;
          height: 100%;
          min-height: 0;
        }

        /* --- NEW: Session Manager Styles --- */
        .session-manager {
          flex-shrink: 0;
          padding-bottom: 15px;
          border-bottom: 2px solid rgba(67, 97, 238, 0.1);
        }
        .session-select {
          width: 100%;
          padding: 12px;
          border-radius: 10px;
          border: 2px solid rgba(67, 97, 238, 0.2);
          font-size: 1em;
          font-family: inherit;
          background-color: #f8f9ff;
          cursor: pointer;
        }
        .session-select:focus {
          outline: none;
          border-color: var(--primary-color);
        }


        .documents-panel-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 15px;
          padding-bottom: 10px;
          border-bottom: 1px solid rgba(67, 97, 238, 0.1);
          flex-shrink: 0;
        }

        .documents-actions {
          display: flex;
          gap: 10px;
        }

        .documents-actions .small-button {
          font-size: 0.9em;
          padding: 8px 15px;
          border-radius: 20px;
          border: none;
          cursor: pointer;
          transition: all 0.3s ease;
          background-color: rgba(67, 97, 238, 0.1);
          color: var(--primary-color);
          font-weight: 500;
        }

        .documents-actions .small-button:hover {
          background-color: rgba(67, 97, 238, 0.2);
          transform: translateY(-1px);
        }
        /* --- Style for disabled upload button --- */
        .upload-button-label.disabled {
            background-color: var(--text-light);
            cursor: not-allowed;
            box-shadow: none;
            transform: none;
        }

        .document-list {
          flex: 1;
          overflow-y: auto;
          padding-right: 5px;
          min-height: 0;
        }

        .document-item {
          margin-bottom: 8px;
          position: relative;
          display: flex; 
          align-items: center; 
          justify-content: space-between; 
          padding: 12px; 
          background-color: #f8f9ff; 
          border-radius: 10px; 
          transition: all 0.2s ease; 
        }

        .document-item:hover {
          background-color: #eef0ff;
          transform: translateY(-1px);
        }

        .document-checkbox {
          display: flex;
          align-items: center;
          cursor: pointer;
          transition: all 0.2s ease;
          position: relative;
          padding: 0; 
          background: none; 
        }


        .document-checkbox input {
          position: absolute;
          opacity: 0;
          cursor: pointer;
          height: 0;
          width: 0;
        }


        .document-item-actions { 
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .delete-icon {
          font-size: 16px;
          font-weight: bold;
          color: #2660d376;
          cursor: pointer;
          opacity: 0.3; 
          transition: opacity 0.2s ease;
        }

        .document-item:hover .delete-icon,
        .delete-icon:hover {
          opacity: 1;
          color: var(--danger-color); 
        }

        .load-context-btn { 
          font-size: 0.8em;
          font-weight: 600;
          padding: 4px 10px;
          border: none;
          border-radius: 6px;
          background-color: rgba(67, 97, 238, 0.2);
          color: var(--primary-color);
          cursor: pointer;
          opacity: 0.6;
          transition: all 0.2s ease;
        }
        .document-item:hover .load-context-btn {
          opacity: 1;
        }
        .load-context-btn:hover {
          background-color: var(--primary-color);
          color: white;
        }


        .checkmark {
          position: relative;
          height: 18px;
          width: 18px;
          background-color: white;
          border: 2px solid rgba(67, 97, 238, 0.3);
          border-radius: 4px;
          margin-right: 12px;
          transition: all 0.2s ease;
        }

        .document-checkbox input:checked ~ .checkmark {
          background-color: var(--primary-color);
          border-color: var(--primary-color);
        }

        .checkmark:after {
          content: "";
          position: absolute;
          display: none;
          left: 5px;
          top: 1px;
          width: 4px;
          height: 10px;
          border: solid white;
          border-width: 0 2px 2px 0;
          transform: rotate(45deg);
        }

        .document-checkbox input:checked ~ .checkmark:after {
          display: block;
        }

        .document-name {
          flex-grow: 1;
          font-size: 0.95em;
        }

        .upload-button-label {
          background-color: var(--primary-color);
          color: white;
          padding: 12px 20px;
          border-radius: 25px;
          cursor: pointer;
          font-weight: 600;
          transition: all 0.3s ease;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          box-shadow: 0 4px 12px rgba(67, 97, 238, 0.3);
        }

        .upload-button-label:hover {
          background-color: var(--secondary-color);
          transform: translateY(-2px);
          box-shadow: 0 6px 18px rgba(67, 97, 238, 0.4);
        }

        .upload-button-label:disabled {
          background: var(--text-light);
          cursor: not-allowed;
          transform: none;
          box-shadow: none;
        }

        .plus-icon {
          font-size: 1.2em;
          line-height: 1;
        }

        .upload-status-message {
          margin-top: 15px;
          font-style: italic;
          color: var(--text-light);
          animation: fadeIn 0.5s ease-out;
          text-align: center; /* Center align */
          padding: 5px; /* Add some padding */
        }

        /* --- Studio Panel Styles --- */
        .studio-container {
          display: flex;
          flex-direction: column;
          height: 100%;
          min-height: 0;
        }

        .studio-header {
          font-size: 1.4em;
          font-weight: 600;
          color: var(--primary-color);
          margin-bottom: 20px;
          padding-bottom: 15px;
          border-bottom: 2px solid rgba(67, 97, 238, 0.1);
          flex-shrink: 0;
        }
        .upper {
        font-weight : 600;
        font-size: 1.4em;
        }
        
        .studio-layout-container {
          display: flex;
          flex-direction: column;
          gap: 15px;
          margin-bottom: 25px;
        }
        
        .studio-top-row {
          display: flex;
          justify-content: center;
          gap: 15px;
        }
        
        .studio-bottom-row {
          display: flex;
          justify-content: center;
        }

        .studio-output-item {
          text-align: center;
          padding: 25px 15px;
          background-color: #f8f9ff;
          border-radius: 12px;
          cursor: pointer;
          transition: all 0.3s ease;
          box-shadow: 0 4px 12px rgba(67, 97, 238, 0.05);
          width: 120px;
          height: 100px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
        }

        .studio-output-item:hover {
          background-color: #eef0ff;
          transform: translateY(-3px) scale(1.02);
          box-shadow: 0 6px 18px rgba(67, 97, 238, 0.1);
        }

        .studio-output-item .output-icon {
          font-size: 2.5em;
          margin-bottom: 5px;
          transition: transform 0.3s ease;
          color: var(--primary-color);
        }

        .studio-output-item:hover .output-icon {
          transform: scale(1.1);
        }

        .studio-output-item p {
          margin: 0;
          font-size: 0.95em;
          font-weight: 600;
          color: var(--text-color);
        }

        .studio-footer {
          margin-top: auto;
          text-align: center;
          flex-shrink: 0;
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
        }

        .daily-quote-container {
            padding: 20px;
            background-color: #f8f9ff;
            border-radius: 12px;
            border-left: 5px solid var(--accent-color);
            width: 100%;
            box-sizing: border-box;
        }

        .quote-text {
            font-style: italic;
            color: var(--text-color);
            margin: 0;
            font-size: 1.05em;
        }

        .quote-label {
            font-size: 0.8em;
            font-weight: 600;
            color: var(--text-light);
            margin: 8px 0 0 0;
            text-transform: uppercase;
            letter-spacing: 1px;
        }

        /* --- Assessment Styles --- */
        .assessment-container {
          height: 100%;
          display: flex;
          flex-direction: column;
          min-height: 0;
        }

        .assessment-quiz-section {
          flex: 1;
          display: flex;
          flex-direction: column;
          min-height: 0;
        }

        .assessment-question {
          font-size: 1.2em;
          font-weight: 600;
          margin-bottom: 20px;
          color: var(--text-color);
        }

        .assessment-options {
          display: flex;
          flex-direction: column;
          gap: 12px;
          margin-bottom: 30px;
          flex: 1;
          overflow-y: auto;
        }

        .assessment-option {
          padding: 15px 20px;
          background-color: #f8f9ff;
          border-radius: 10px;
          cursor: pointer;
          transition: all 0.2s ease;
          border: 2px solid transparent;
        }

        .assessment-option:hover {
          background-color: #eef0ff;
          transform: translateY(-2px);
        }

        .assessment-option.selected {
          background-color: #e0e7ff;
          border-color: var(--primary-color);
          box-shadow: 0 4px 12px rgba(67, 97, 238, 0.1);
        }

        .assessment-navigation {
          display: flex;
          justify-content: space-between;
          margin-top: auto;
          flex-shrink: 0;
        }

        .assessment-navigation button {
          padding: 12px 25px;
          border-radius: 25px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s ease;
        }

        .assessment-navigation button:first-child {
          background-color: #f8f9ff;
          color: var(--text-color);
          border: none;
        }

        .assessment-navigation button:last-child {
          background-color: var(--primary-color);
          color: white;
          border: none;
          box-shadow: 0 4px 12px rgba(67, 97, 238, 0.3);
        }

        .assessment-navigation button:disabled {
          opacity: 0.7;
          cursor: not-allowed;
          transform: none !important;
        }

        .assessment-navigation button:first-child:hover:not(:disabled) {
          background-color: #eef0ff;
          transform: translateY(-2px);
        }

        .assessment-navigation button:last-child:hover:not(:disabled) {
          background-color: var(--secondary-color);
          transform: translateY(-2px);
          box-shadow: 0 6px 15px rgba(67, 97, 238, 0.4);
        }

        .assessment-result {
          text-align: center;
          padding: 20px;
        }

        .assessment-result h3 {
          color: var(--primary-color);
          margin-bottom: 10px;
        }
        
        /* --- Compulsory Assessment Full-Screen Style --- */
        .compulsory-assessment-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background-color: #f5f7ff;
            z-index: 9999;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 2rem;
            box-sizing: border-box;
            animation: fadeIn 0.5s ease-out;
        }
        .compulsory-assessment-overlay .assessment-container {
           width: 100%;
           max-width: 800px;
           height: auto;
           max-height: 90vh;
           background-color: #ffffff;
           border-radius: 16px;
           box-shadow: 0 10px 40px rgba(0, 0, 0, 0.1);
           padding: 2rem 3rem;
           box-sizing: border-box;
        }
        
        /* --- New Notes Panel Styles --- */
        .notes-panel-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0, 0, 0, 0.6);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 1000;
            backdrop-filter: blur(5px);
            animation: fadeIn 0.3s ease;
        }
        .notes-panel {
            background: #ffffff;
            border-radius: 16px;
            box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
            width: 90%;
            max-width: 600px;
            height: 70vh;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            animation: slideInUp 0.4s ease;
        }
        .notes-panel-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 15px 25px;
            border-bottom: 1px solid #e0e0e0;
            flex-shrink: 0;
        }
        .notes-panel-header h3 {
            margin: 0;
            color: var(--primary-color);
        }
        .notes-close-btn {
            background: none;
            border: none;
            font-size: 24px;
            color: var(--text-light);
            cursor: pointer;
            transition: color 0.2s ease;
        }
        .notes-close-btn:hover {
            color: var(--danger-color);
        }
        .notes-panel-content {
            flex: 1;
            padding: 25px;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
        }
        .notes-textarea {
            width: 100%;
            flex-grow: 1;
            min-height: 150px;
            border: 2px solid #e0e7ff;
            border-radius: 12px;
            padding: 15px;
            font-family: inherit;
            font-size: 1em;
            resize: vertical;
            transition: border-color 0.3s ease, box-shadow 0.3s ease;
        }
        .notes-textarea:focus {
            outline: none;
            border-color: var(--primary-color);
            box-shadow: 0 0 0 3px rgba(67, 97, 238, 0.2);
        }
        .highlight-summary-section {
            margin-top: 20px;
            padding: 15px;
            background-color: #f8f9ff;
            border-radius: 12px;
            flex-shrink: 0;
        }
        .highlighted-text-info {
            font-size: 0.9em;
            color: var(--text-color);
            margin: 0 0 10px 0;
            word-break: break-word;
        }
        .summary-result-box {
            margin-top: 15px;
            padding: 15px;
            background: linear-gradient(to bottom, #f8f9ff, #eef0ff);
            border-left: 4px solid var(--accent-color);
            border-radius: 8px;
            font-size: 0.95em;
            line-height: 1.6;
            color: var(--text-color);
            flex-shrink: 0;
        }
        .notes-panel-actions {
            padding: 15px 25px;
            border-top: 1px solid #e0e0e0;
            display: flex;
            justify-content: flex-end;
            gap: 10px;
            flex-shrink: 0;
        }
        .notes-panel-btn {
            padding: 10px 20px;
            border-radius: 25px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            border: none;
        }
        .notes-panel-btn.save {
            background-color: var(--success-color);
            color: white;
        }
        .notes-panel-btn.summarize {
            background-color: var(--accent-color);
            color: white;
        }
        .notes-panel-btn:disabled {
            opacity: 0.6;
            cursor: not-allowed;
        }
        .notes-panel-btn:hover:not(:disabled) {
            transform: translateY(-2px);
        }
        @keyframes slideInUp {
            from { transform: translateY(30px); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
        }
        
        /* --- Note List Styles --- */
        .notes-list-container {
          padding: 25px;
          display: flex;
          flex-direction: column;
          height: 100%;
          box-sizing: border-box;
        }
        .notes-list {
          flex-grow: 1;
          overflow-y: auto;
          margin-top: 15px; /* Added margin-top */
          padding-right: 5px; /* Added padding for scrollbar */
        }
        .note-item {
          background: #f8f9ff;
          border-radius: 8px;
          padding: 15px 20px;
          margin-bottom: 10px;
          cursor: pointer;
          border: 1px solid #eef0ff;
          transition: all 0.2s ease;
        }
        .note-item:hover {
          background: #eef0ff;
          border-color: var(--primary-color);
          transform: translateX(2px);
        }
        .note-snippet {
          margin: 0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          color: var(--text-color);
        }


        /* --- Doc Audio Popup Styles --- */
        .doc-audio-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .doc-audio-button {
          padding: 12px 18px;
          border-radius: 8px;
          border: none;
          background-color: var(--primary-color);
          color: white;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s ease;
          text-align: left;
        }
        .doc-audio-button:hover:not(:disabled) {
          background-color: var(--secondary-color);
        }
        .doc-audio-button:disabled {
          background-color: var(--text-light);
          cursor: not-allowed;
        }


        /* --- Animations & other general styles --- */
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideInRight {
          from { opacity: 0; transform: translateX(20px); }
          to { opacity: 1; transform: translateX(0); }
        }

        @keyframes slideInLeft {
          from { opacity: 0; transform: translateX(-20px); }
          to { opacity: 1; transform: translateX(0); }
        }

        .loading-message {
          display: flex;
          align-items: center;
          gap: 10px;
          margin: 15px auto;
          color: var(--text-light);
        }

        .loading-dots {
          display: flex;
          gap: 5px;
        }
        .loading-dots span {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background-color: var(--primary-color);
          animation: bounceDot 1.4s infinite ease-in-out;
        }
        .loading-dots span:nth-child(1) { animation-delay: -0.32s; }
        .loading-dots span:nth-child(2) { animation-delay: -0.16s; }
        .loading-dots span:nth-child(3) { animation-delay: 0s; }
        @keyframes bounceDot {
          0%, 80%, 100% { transform: scale(1); }
          40% { transform: scale(1); }
        }

        /* Code block styling */
        .code-block-container {
          position: relative;
          margin: 20px 0;
          border-radius: 12px;
          overflow: hidden;
          box-shadow: 0 8px 30px rgba(0, 50, 100, 0.3);
          background: #282a36; /* Dracula background */
          font-family: 'Fira Code', 'Consolas', 'Monaco', monospace;
        }

        .code-block-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          background: #1e1f29;
          color: #f8f82;
          padding: 12px 20px;
          font-size: 0.9em;
          font-weight: 600;
        }

        .code-block-content {
          padding: 15px;
          color: #f8f8f2;
          overflow-x: auto;
        }

        .code-block-content code {
          font-family: inherit;
          font-size: 0.95em;
        }

        .copy-button {
          background: #44475a;
          color: #f8f8f2;
          border: 1px solid #6272a4;
          padding: 6px 14px;
          border-radius: 6px;
          cursor: pointer;
          font-size: 0.8em;
          font-weight: 500;
          transition: all 0.2s ease;
        }
        .copy-button:hover {
          background: #6272a4;
        }

        .head {
          font-weight : 600;
          font-size : 1.4em;
        }

        /* --- Test Feature Styles (kept for completeness) --- */
        .test-overlay { /* ... styles ... */ }
        .test-feature-container { /* ... styles ... */ }
        .test-exit-button { /* ... styles ... */ }
        .test-idle-container { /* ... styles ... */ }
        .test-idle-header { /* ... styles ... */ }
        .test-idle-p { /* ... styles ... */ }
        .test-generate-button { /* ... styles ... */ }
        .test-taking-container { /* ... styles ... */ }
        .test-results-container, .test-history-container { /* ... styles ... */ }
        .test-results-header, .test-history-header { /* ... styles ... */ }
        .test-results-grid { /* ... styles ... */ }
        .test-results-analysis-grid { /* ... styles ... */ }
        .test-feedback-card { /* ... styles ... */ }
        .test-action-buttons-container { /* ... styles ... */ }
        .test-history-kpi-grid { /* ... styles ... */ }
        .dashboard-content-area { /* ... styles ... */ }
        .performance-breakdown-card { /* ... styles ... */ }
        .category-cards-grid { /* ... styles ... */ }
        .test-taking-header { /* ... styles ... */ }
        .test-question-scroll-area { /* ... styles ... */ }
        .test-question-category { /* ... styles ... */ }
        .test-question-title { /* ... styles ... */ }
        .test-progress-bar-background { /* ... styles ... */ }
        .test-progress-bar-foreground { /* ... styles ... */ }
        .test-question-card { /* ... styles ... */ }
        .test-question-text { /* ... styles ... */ }
        .test-options-container { /* ... styles ... */ }
        .test-option-button { /* ... styles ... */ }
        .test-navigation-buttons { /* ... styles ... */ }
        .test-nav-button { /* ... styles ... */ }
        .test-tooltip { /* ... styles ... */ }
        .test-results-chart-column { /* ... styles ... */ }
        .test-results-subtitle { /* ... styles ... */ }
        .test-pie-chart-container { /* ... styles ... */ }
        .test-pie-slice { /* ... styles ... */ }
        .test-legend-container { /* ... styles ... */ }
        .test-legend-item { /* ... styles ... */ }
        .test-legend-dot { /* ... styles ... */ }
        .test-legend-label { /* ... styles ... */ }
        .test-legend-score { /* ... styles ... */ }
        .cat-bg-blue { /* ... styles ... */ }
        .cat-bg-green { /* ... styles ... */ }
        .cat-bg-red { /* ... styles ... */ }
        .cat-bg-yellow { /* ... styles ... */ }
        .test-feedback-score { /* ... styles ... */ }
        .test-feedback-analysis { /* ... styles ... */ }
        .test-feedback-tips { /* ... styles ... */ }
        .test-action-button { /* ... styles ... */ }
        .test-history-kpi-card { /* ... styles ... */ }
        .test-history-kpi-value { /* ... styles ... */ }
        .test-history-kpi-subtext { /* ... styles ... */ }

      }
      `}</style>

      {!isAuthenticated ? (
        <LoginPage onLogin={handleLogin} />
      ) : isTakingCompulsoryAssessment ? (
        <div className="compulsory-assessment-overlay">
            {renderAssessment()}
        </div>
      ) : (
        <div className="main-app-container">
          <div className="top-nav">
            <span className="app-logo">
              EduMind
              {assessmentResult && <span title={assessmentResult.learning_style} className="learner-icon">{getLearnerIcon(assessmentResult.learning_style)}</span>}
            </span>
            <div className="nav-buttons">
              <button onClick={() => setCurrentView('chat')} className={currentView === 'chat' || currentView === 'documents' ? 'active' : ''} disabled={currentView === 'assessment'}>Chatbot</button>
              <button onClick={startAssessment} className={currentView === 'assessment' ? 'active' : ''}>Assessment</button>
              {/* <button onClick={() => setCurrentView('documents')} className={currentView === 'documents' ? 'active' : ''} disabled={currentView === 'assessment'}>Documents</button> */}
              <button onClick={() => setCurrentView('test')} className={currentView === 'test' ? 'active' : ''} disabled={currentView === 'assessment'}>Test</button>
            </div>
          </div>

          <div className="main-content-grid">
            <div className="panel">
              {renderDocuments()}
            </div>

            <div className="panel">
              <div className="panel-header">
                <div className="head">
                  {currentView === 'chat' || currentView === 'documents'
                    ? sessions[activeSessionId!]?.name || "Chat"
                    : capitalize(currentView)
                  }
                </div>
              </div>
              <div className="panel-content">
                {renderMainContent()}
              </div>
            </div>

            <div className="panel">
              {renderStudio()}
            </div>
          </div>
        </div>
      )}

      {isAuthenticated && !isTakingCompulsoryAssessment && isNotesPanelOpen && renderNotesPanel()}
      {isAuthenticated && !isTakingCompulsoryAssessment && isMainAudioPopupOpen && renderMainAudioPopup()}
    </>

  );
}

export default App;