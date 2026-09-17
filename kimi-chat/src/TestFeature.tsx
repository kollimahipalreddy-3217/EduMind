import React, { useState, useMemo, FC, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';

// --- TYPE DEFINITIONS ---
export type ViewState = 'idle' | 'takingTest' | 'results' | 'history';

interface Question {
  id: number;
  category: string;
  questionText: string;
  options: string[];
  correctAnswer: string;
}

interface TestData {
  testId: string;
  questions: Question[];
}

type UserAnswers = {
  [key: number]: string;
};

export type CategoryScores = {
    [category: string]: {
      score: number;
      total: number;
    };
};

export type PerformanceResult = {
  testId: string;
  scores: CategoryScores;
  timestamp: number;
};


// --- API Service ---
const API_BASE_URL = "http://127.0.0.1:8000";

const apiService = {
  generateTest: async (documentChunks: string[], signal?: AbortSignal): Promise<TestData> => {
    const response = await fetch(`${API_BASE_URL}/generate-test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ document_chunks: documentChunks }),
      signal,
    });
    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || "Failed to generate test");
    }
    return response.json();
  },
  getDocumentText: async (documentName: string, signal?: AbortSignal): Promise<{content: string}> => {
    const response = await fetch(`${API_BASE_URL}/document-text/${encodeURIComponent(documentName)}`, {
        signal
    });
    if (!response.ok) {
        throw new Error(`Failed to fetch content for document: ${documentName}`);
    }
    return response.json();
  }
};


// --- HELPER DATA FOR RESULTS VIEW ---
const categoryFeedback: { [key: string]: { [score: number]: { analysis: string; tips: string[] } } } = {
    "Cognitive Memory": {
        0: { analysis: "You seem to be struggling with recalling key facts. It's important to build this foundation.", tips: ["Re-read the source material, focusing on definitions.", "Use flashcards for key terms.", "Try to summarize sections in your own words."] },
        1: { analysis: "You're starting to remember some details, but there are gaps in your recall of specific information.", tips: ["Pay close attention to names, dates, and specific data.", "Create mnemonics to remember lists or sequences.", "Review the material shortly after reading it."] },
        2: { analysis: "You have a decent memory of the core concepts but miss some of the finer details.", tips: ["Challenge yourself to recall information without looking at the text.", "Explain the concepts to someone else to solidify them.", "Draw diagrams to connect key facts."] },
        3: { analysis: "You have a good grasp of the facts and figures presented in the material.", tips: ["Continue to review to ensure long-term retention.", "Try to connect these facts to broader themes.", "Look for patterns in the information presented."] },
        4: { analysis: "Excellent! Your recall of the details in the text is outstanding.", tips: ["Challenge yourself by looking for information that was implied but not stated.", "Consider how these facts might be used in a larger argument."] }
    },
    "Logical Reasoning": {
        0: { analysis: "You're finding it difficult to connect ideas and draw conclusions from the text.", tips: ["Focus on identifying 'cause and effect' relationships.", "Look for keywords like 'because', 'therefore', and 'as a result'.", "Break down complex sentences into smaller parts."] },
        1: { analysis: "You can follow simple arguments but struggle when the logic becomes more complex.", tips: ["Practice identifying the premises and conclusion of an argument.", "Map out the flow of an argument visually.", "Question the assumptions behind each statement."] },
        2: { analysis: "You can follow most lines of reasoning but can improve in spotting flawed logic or assumptions.", tips: ["Consider alternative conclusions that could be drawn from the evidence.", "Ask 'why' at each step of a logical progression.", "Look for inconsistencies in the text."] },
        3: { analysis: "You have strong logical reasoning skills and can effectively follow the author's arguments.", tips: ["Analyze the strength of the evidence used to support claims.", "Try to anticipate the next step in a logical sequence.", "Identify any unstated assumptions."] },
        4: { analysis: "Perfect! Your ability to understand and interpret logical connections is exceptional.", tips: ["Consider the broader implications of the arguments presented.", "Deconstruct complex arguments to identify their core structure."] }
    },
    "Critical Thinking": {
        0: { analysis: "You're having trouble analyzing and evaluating the claims made in the document.", tips: ["Start by identifying the author's main thesis or argument.", "Question the evidence presented: Is it strong or weak?", "Don't accept claims at face value; ask 'why should I believe this?'"] },
        1: { analysis: "You can identify the main points but find it challenging to evaluate their strengths and weaknesses.", tips: ["Compare and contrast different concepts within the text.", "Consider the author's potential biases.", "Look for what might be missing from the argument."] },
        2: { analysis: "You have a foundational understanding but can improve in evaluating nuanced arguments and evidence.", tips: ["Practice distinguishing between fact and opinion.", "Assess the credibility of the sources if they are mentioned.", "Think about the real-world implications of the arguments."] },
        3: { analysis: "You are a strong critical thinker, capable of analyzing and questioning the material effectively.", tips: ["Synthesize information from different parts of the text to form your own conclusion.", "Propose counter-arguments to the author's claims.", "Evaluate the overall effectiveness of the author's argument."] },
        4: { analysis: "Outstanding! You demonstrate a superior ability to analyze, evaluate, and critique the text.", tips: ["Extend the author's argument to new contexts.", "Identify the ideological or philosophical underpinnings of the text."] }
    },
    "Creative Application": {
        0: { analysis: "Applying the concepts from the text to new situations is a major challenge right now.", tips: ["First, ensure you understand the core principles in the text.", "Think of a simple, real-world example for each main concept.", "Don't be afraid to brainstorm multiple solutions to a problem."] },
        1: { analysis: "You can apply concepts to familiar scenarios but struggle with more abstract or novel problems.", tips: ["Try to rephrase the problem in your own words.", "Break the problem down into smaller, more manageable parts.", "Relate the new scenario back to a specific example from the text."] },
        2: { analysis: "You can apply principles to new scenarios but could be more flexible in your problem-solving.", tips: ["Consider multiple, different approaches to solving the problem.", "Think about the long-term consequences of your proposed solution.", "Collaborate with others to see different perspectives."] },
        3: { analysis: "You are skilled at applying information from the text to solve new and unfamiliar problems.", tips: ["Try to combine different principles from the text in innovative ways.", "Think about the potential limitations of your solution.", "How could your solution be improved or made more efficient?"] },
        4: { analysis: "Exceptional! Your ability to creatively apply knowledge to new contexts is top-tier.", tips: ["Design a new problem that could be solved using the text's principles.", "Consider how these principles might apply to a completely different field."] }
    }
};

const categoryColors: { [key: string]: { fill: string; bg: string; } } = {
    "Cognitive Memory":     { fill: '#60a5fa', bg: 'cat-bg-blue' },
    "Logical Reasoning":    { fill: '#4ade80', bg: 'cat-bg-green' },
    "Critical Thinking":    { fill: '#f87171', bg: 'cat-bg-red' },
    "Creative Application": { fill: '#facc15', bg: 'cat-bg-yellow' },
};

// --- Helper Functions ---
const getSlicePath = (cx: number, cy: number, radius: number, startAngle: number, endAngle: number) => {
    const start = {
        x: cx + radius * Math.cos(startAngle * Math.PI / 180),
        y: cy + radius * Math.sin(startAngle * Math.PI / 180)
    };
    const end = {
        x: cx + radius * Math.cos(endAngle * Math.PI / 180),
        y: cy + radius * Math.sin(endAngle * Math.PI / 180)
    };
    const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
    const d = [ "M", cx, cy, "L", start.x, start.y, "A", radius, radius, 0, largeArcFlag, 1, end.x, end.y, "Z" ].join(" ");
    return d;
};


// --- UI COMPONENTS ---

const IdleView: FC<{ 
    onGenerate: () => void; 
    loading: boolean;
    hasHistory: boolean;
    onViewHistory: () => void;
}> = ({ onGenerate, loading, hasHistory, onViewHistory }) => (
    <div className="test-idle-container">
        <h1 className="test-idle-header">Test Your Knowledge</h1>
        <p className="test-idle-p">Select a single document from the 'Sources' panel and generate a test to assess your understanding.</p>
        <div className="test-action-buttons-container">
            <button
                onClick={onGenerate}
                disabled={loading}
                className="test-generate-button test-action-button primary"
            >
                {loading ? 'Generating...' : 'Generate New Test'}
            </button>
            {hasHistory && (
                <button onClick={onViewHistory} className="test-action-button secondary">
                    View Performance History
                </button>
            )}
        </div>
    </div>
);

const TakingTestView: FC<{
  testData: TestData;
  userAnswers: UserAnswers;
  onAnswerSelect: (questionId: number, answer: string) => void;
  onFinish: () => void;
  onExit: () => void;
}> = ({ testData, userAnswers, onAnswerSelect, onFinish, onExit }) => {
    const [currentIndex, setCurrentIndex] = useState(0);
    const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
    const currentQuestion = testData.questions[currentIndex];
    const totalQuestions = testData.questions.length;

    useEffect(() => {
        optionRefs.current = optionRefs.current.slice(0, currentQuestion.options.length);
    }, [currentQuestion]);

    const handleNext = useCallback(() => {
        if (currentIndex < totalQuestions - 1) {
            setCurrentIndex(i => i + 1);
        } else {
            onFinish();
        }
    }, [currentIndex, totalQuestions, onFinish]);

    useEffect(() => {
        const handleKeyPress = (event: KeyboardEvent) => {
            // --- FIX FOR AUTO-SELECTION BUG ---
            if (event.key === 'Enter') {
                if (userAnswers[currentQuestion.id]) {
                    event.preventDefault(); // Prevents the Enter key from triggering a click on the next question
                    handleNext();
                }
            }

            // --- FEATURE FOR ARROW KEY NAVIGATION ---
            const arrowKeys = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
            if (arrowKeys.includes(event.key)) {
                event.preventDefault();
                
                const currentFocus = document.activeElement;
                let focusIndex = -1;

                if (currentFocus instanceof HTMLButtonElement) {
                    focusIndex = optionRefs.current.indexOf(currentFocus);
                }
                
                if (focusIndex === -1) {
                    optionRefs.current[0]?.focus();
                    return;
                }

                let nextIndex = focusIndex;
                switch (event.key) {
                    case "ArrowLeft":
                        nextIndex = focusIndex % 2 === 0 ? focusIndex : focusIndex - 1;
                        break;
                    case "ArrowRight":
                        nextIndex = focusIndex % 2 !== 0 ? focusIndex : focusIndex + 1;
                        break;
                    case "ArrowUp":
                        nextIndex = focusIndex < 2 ? focusIndex : focusIndex - 2;
                        break;
                    case "ArrowDown":
                        nextIndex = focusIndex > 1 ? focusIndex : focusIndex + 2;
                        break;
                }

                if (nextIndex >= 0 && nextIndex < optionRefs.current.length) {
                    optionRefs.current[nextIndex]?.focus();
                }
            }
        };

        document.addEventListener('keydown', handleKeyPress);
        return () => {
            document.removeEventListener('keydown', handleKeyPress);
        };
    }, [userAnswers, currentQuestion, handleNext]);

    return (
        <div className="test-taking-container">
            <div className="test-taking-header">
                <p className="test-question-category">{currentQuestion.category}</p>
                <h2 className="test-question-title">
                    Question {currentIndex + 1} of {totalQuestions}
                </h2>
                <div className="test-progress-bar-background">
                    <div
                        className="test-progress-bar-foreground"
                        style={{ width: `${((currentIndex + 1) / totalQuestions) * 100}%` }}
                    ></div>
                </div>
            </div>

            <div className="test-question-scroll-area">
              <div className="test-question-card">
                  <p className="test-question-text">{currentQuestion.questionText}</p>
                  <div className="test-options-container">
                      {currentQuestion.options.map((option, index) => {
                          const isSelected = userAnswers[currentQuestion.id] === option;
                          return (
                              <button
                                  key={index}
                                  ref={(el) => { optionRefs.current[index] = el; }}
                                  onClick={() => onAnswerSelect(currentQuestion.id, option)}
                                  className={`test-option-button ${isSelected ? 'selected' : ''}`}
                              >
                                  {option}
                              </button>
                          );
                      })}
                  </div>
              </div>
            </div>

            <div className="test-navigation-buttons">
                <button onClick={onExit} className="test-nav-button exit">End Test</button>
                <div style={{display: 'flex', gap: '1rem'}}>
                    <button
                        onClick={() => setCurrentIndex(i => i - 1)}
                        disabled={currentIndex === 0}
                        className="test-nav-button"
                    >
                        Previous
                    </button>
                    <button
                        onClick={handleNext}
                        disabled={!userAnswers[currentQuestion.id]}
                        className={`test-nav-button ${currentIndex === totalQuestions - 1 ? 'finish' : 'primary'}`}
                    >
                        {currentIndex === totalQuestions - 1 ? 'Finish & See Results' : 'Next'}
                    </button>
                </div>
            </div>
        </div>
    );
};

const ResultsView: FC<{
    result: PerformanceResult;
    onRetake: () => void;
    onViewHistory: () => void;
}> = ({ result, onRetake, onViewHistory }) => {
    const [tooltip, setTooltip] = useState<{ content: string; x: number; y: number } | null>(null);
    const categories = Object.keys(result.scores);
    
    const totalCorrect = categories.reduce((acc, cat) => acc + result.scores[cat].score, 0);
    const totalQuestions = categories.reduce((acc, cat) => acc + result.scores[cat].total, 0);
    let cumulativeAngle = -90;

    return (
        <div className="test-results-container">
            {tooltip && (
                <div className="test-tooltip" style={{ top: tooltip.y, left: tooltip.x }}>
                    {tooltip.content}
                </div>
            )}
            <div className="test-results-header">
                <h1>Performance Analysis</h1>
                <p>You got {totalCorrect} out of {totalQuestions} questions correct. Here's a breakdown of your performance.</p>
            </div>

            <div className="test-results-grid">
                <div className="test-results-chart-column">
                    <h3>Overall Performance</h3>
                    <p className="test-results-subtitle">Distribution of your correct answers.</p>
                    <div className="test-pie-chart-container">
                        <svg width="180" height="180" viewBox="0 0 120 120">
                            <g>
                                {totalCorrect > 0 ? categories.map(cat => {
                                    const { score, total } = result.scores[cat];
                                    if (score === 0) return null;
                                    const angle = (score / totalCorrect) * 360;
                                    const startAngle = cumulativeAngle;
                                    const endAngle = cumulativeAngle + angle;
                                    const pathData = getSlicePath(60, 60, 56, startAngle, endAngle);
                                    cumulativeAngle = endAngle;

                                    return (
                                        <path
                                            key={cat}
                                            d={pathData}
                                            fill={categoryColors[cat]?.fill || '#ccc'}
                                            stroke="white"
                                            strokeWidth="3"
                                            className="test-pie-slice"
                                            onMouseMove={(e) => setTooltip({ content: `${cat}: ${score}/${total}`, x: e.clientX + 15, y: e.clientY + 15 })}
                                            onMouseLeave={() => setTooltip(null)}
                                        />
                                    );
                                }) : <circle cx="60" cy="60" r="56" fill="#F3F4F6" />}
                            </g>
                            <circle cx="60" cy="60" r="38" fill="white" />
                        </svg>
                    </div>
                     <div className="test-legend-container">
                        {categories.map(cat => (
                            <div key={cat} className="test-legend-item">
                                <span className={`test-legend-dot ${categoryColors[cat]?.bg}`}></span>
                                <span className="test-legend-label">{cat}</span>
                                <span className="test-legend-score">{result.scores[cat].score}/{result.scores[cat].total}</span>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="test-results-analysis-grid">
                    {categories.map(cat => {
                         const { score, total } = result.scores[cat];
                         const avgScore = total > 0 ? Math.round((score / total) * 4) : 0;
                         const feedback = categoryFeedback[cat]?.[avgScore];
                         if (!feedback || total === 0) return null;
                         return (
                            <div key={cat} className="test-feedback-card">
                                <div>
                                    <h4>{cat}</h4>
                                    <p className="test-feedback-score">{score}/{total}</p>
                                    <p className="test-feedback-analysis">{feedback.analysis}</p>
                                </div>
                                <div className="test-feedback-tips">
                                    <h5>Actionable Tips:</h5>
                                    <ul>
                                        {feedback.tips.map((tip, i) => <li key={i}>{tip}</li>)}
                                    </ul>
                                </div>
                            </div>
                         );
                    })}
                </div>
            </div>
             <div className="test-action-buttons-container">
                <button onClick={onViewHistory} className="test-action-button secondary">
                  View Overall Performance
                </button>
                <button onClick={onRetake} className="test-action-button primary">
                    Take a New Test
                </button>
            </div>
        </div>
    );
};

const HistoryView: FC<{
    overallScores: CategoryScores;
    history: PerformanceResult[];
    onBack: () => void;
    onRetake: () => void;
}> = ({ overallScores, history, onBack, onRetake }) => {
    const [tooltip, setTooltip] = useState<{ content: string; x: number; y: number } | null>(null);
    const categories = Object.keys(overallScores);
    const totalCorrect = categories.reduce((acc, cat) => acc + overallScores[cat].score, 0);
    const totalQuestions = categories.reduce((acc, cat) => acc + overallScores[cat].total, 0);
    const overallAverage = totalQuestions > 0 ? ((totalCorrect / totalQuestions) * 100).toFixed(0) : 0;
    let cumulativeAngle = -90;
    
    return (
        <div className="test-history-container">
             {tooltip && (
                <div className="test-tooltip" style={{ top: tooltip.y, left: tooltip.x }}>
                    {tooltip.content}
                </div>
            )}
            <div className="test-history-header">
                <h1>Overall Performance Dashboard</h1>
                <p>A summary of your performance across all {history.length} tests taken.</p>
            </div>
            
            <div className="test-history-kpi-grid">
                <div className="test-history-kpi-card">
                    <h4>Overall Average</h4>
                    <p className="test-history-kpi-value">{overallAverage}%</p>
                    <p className="test-history-kpi-subtext">{totalCorrect} / {totalQuestions} Correct</p>
                </div>
                <div className="test-history-kpi-card">
                    <h4>Tests Completed</h4>
                    <p className="test-history-kpi-value">{history.length}</p>
                    <p className="test-history-kpi-subtext">Keep up the great work!</p>
                </div>
                <div className="test-history-kpi-card">
                    <h4>Best Category</h4>
                    <p className="test-history-kpi-value">
                        {categories.reduce((best, cat) => {
                            const bestScore = overallScores[best].total > 0 ? overallScores[best].score / overallScores[best].total : 0;
                            const currentScore = overallScores[cat].total > 0 ? overallScores[cat].score / overallScores[cat].total : 0;
                            return currentScore > bestScore ? cat : best;
                        }, categories[0] || 'N/A')}
                    </p>
                    <p className="test-history-kpi-subtext">Keep reviewing this area!</p>
                </div>
            </div>

            <div className="dashboard-content-area">
                <div className="performance-breakdown-card">
                    <h3>Performance Breakdown</h3>
                    <p className="test-results-subtitle">Distribution of your total correct answers.</p>
                    <div className="test-pie-chart-container">
                        <svg width="180" height="180" viewBox="0 0 120 120">
                            <g>
                                {totalCorrect > 0 ? categories.map(cat => {
                                    const { score } = overallScores[cat];
                                    if (score === 0) return null;
                                    const angle = (score / totalCorrect) * 360;
                                    const startAngle = cumulativeAngle;
                                    const endAngle = cumulativeAngle + angle;
                                    const pathData = getSlicePath(60, 60, 56, startAngle, endAngle);
                                    cumulativeAngle = endAngle;

                                    return (
                                        <path
                                            key={cat}
                                            d={pathData}
                                            fill={categoryColors[cat]?.fill || '#ccc'}
                                            stroke="white"
                                            strokeWidth="3"
                                            className="test-pie-slice"
                                            onMouseMove={(e) => setTooltip({ content: `${cat}: ${score}/${overallScores[cat].total}`, x: e.clientX + 15, y: e.clientY + 15 })}
                                            onMouseLeave={() => setTooltip(null)}
                                        />
                                    );
                                }) : <circle cx="60" cy="60" r="56" fill="#F3F4F6" />}
                            </g>
                            <circle cx="60" cy="60" r="38" fill="white" />
                        </svg>
                    </div>
                     <div className="test-legend-container">
                        {categories.map(cat => (
                            <div key={cat} className="test-legend-item">
                                <span className={`test-legend-dot ${categoryColors[cat]?.bg}`}></span>
                                <span className="test-legend-label">{cat}</span>
                                <span className="test-legend-score">{overallScores[cat].score}/{overallScores[cat].total}</span>
                            </div>
                        ))}
                    </div>
                </div>
                 <div className="category-cards-grid">
                     {categories.map(cat => {
                             const { score, total } = overallScores[cat];
                             if (total === 0) return null;
                             const avgScore = total > 0 ? Math.round((score / total) * 4) : 0;
                             const feedback = categoryFeedback[cat]?.[avgScore];
                             if (!feedback) return null;
                             return (
                                <div key={cat} className="test-feedback-card">
                                    <div>
                                        <h4>{cat}</h4>
                                        <p className="test-feedback-score">{score}/{total}</p>
                                        <p className="test-feedback-analysis">{feedback.analysis}</p>
                                    </div>
                                    <div className="test-feedback-tips">
                                        <h5>Actionable Tips:</h5>
                                        <ul>
                                            {feedback.tips.map((tip, i) => <li key={i}>{tip}</li>)}
                                        </ul>
                                    </div>
                                </div>
                             );
                        })}
                </div>
            </div>
             <div className="test-action-buttons-container">
                <button onClick={onBack} className="test-action-button secondary">
                  Back to Dashboard
                </button>
                 <button onClick={onRetake} className="test-action-button primary">
                    Take a New Test
                </button>
            </div>
        </div>
    );
};


// --- MAIN APP COMPONENT ---

interface TestFeatureProps {
    activeDocuments: string[];
}

const TestFeature: FC<TestFeatureProps> = ({ activeDocuments }) => {
    const [currentView, setCurrentView] = useState<ViewState>('idle');
    const [isLoading, setIsLoading] = useState(false);
    const [testData, setTestData] = useState<TestData | null>(null);
    const [userAnswers, setUserAnswers] = useState<UserAnswers>({});
    
    // State is now initialized from localStorage and persisted with a useEffect hook.
    const [performanceHistory, setPerformanceHistory] = useState<PerformanceResult[]>(() => {
        try {
            const savedHistory = window.localStorage.getItem('performanceHistory');
            return savedHistory ? JSON.parse(savedHistory) : [];
        } catch (error) {
            console.error("Could not parse performance history from localStorage", error);
            return [];
        }
    });

    useEffect(() => {
        try {
            window.localStorage.setItem('performanceHistory', JSON.stringify(performanceHistory));
        } catch (error) {
            console.error("Could not save performance history to localStorage", error);
        }
    }, [performanceHistory]);
    
    const overallPerformance = useMemo<CategoryScores>(() => {
        const combinedScores: CategoryScores = {
            "Cognitive Memory": { score: 0, total: 0 },
            "Logical Reasoning": { score: 0, total: 0 },
            "Critical Thinking": { score: 0, total: 0 },
            "Creative Application": { score: 0, total: 0 },
        };

        performanceHistory.forEach(result => {
            for (const category in result.scores) {
                if (combinedScores[category]) {
                    combinedScores[category].score += result.scores[category].score;
                    combinedScores[category].total += result.scores[category].total;
                }
            }
        });

        return combinedScores;
    }, [performanceHistory]);


    const handleGenerateTest = async () => {
        if (activeDocuments.length !== 1) {
            alert("Please select exactly one document from the 'Sources' panel to generate a test.");
            return;
        }
        const documentName = activeDocuments[0];

        setIsLoading(true);
        try {
            const { content } = await apiService.getDocumentText(documentName);
            const chunkSize = 18000;
            const overlap = 2000;
            const chunks = [];
            for (let i = 0; i < content.length; i += chunkSize - overlap) {
                chunks.push(content.substring(i, i + chunkSize));
            }
            const data = await apiService.generateTest(chunks);

            if (data.questions && data.questions.length > 0) {
                setTestData(data);
                setUserAnswers({});
                setCurrentView('takingTest');
            } else {
                throw new Error("Received an empty or invalid test from the server.");
            }
        } catch (error) {
            console.error("Failed to generate test:", error);
            alert(`Could not generate the test. Error: ${error instanceof Error ? error.message : String(error)}`);
            setCurrentView('idle');
        } finally {
            setIsLoading(false);
        }
    };
   
    const handleAnswerSelect = (questionId: number, answer: string) => {
        setUserAnswers(prev => ({ ...prev, [questionId]: answer }));
    };

    const handleFinishTest = () => {
        if (!testData) return;

        const scores: CategoryScores = {
            "Cognitive Memory": { score: 0, total: 0 },
            "Logical Reasoning": { score: 0, total: 0 },
            "Critical Thinking": { score: 0, total: 0 },
            "Creative Application": { score: 0, total: 0 },
        };
       
        testData.questions.forEach(q => {
            if (scores[q.category]) {
                scores[q.category].total += 1;
                if (userAnswers[q.id] === q.correctAnswer) {
                    scores[q.category].score += 1;
                }
            }
        });

        const newResult: PerformanceResult = { testId: testData.testId, scores, timestamp: Date.now() };
        setPerformanceHistory(prev => [...prev, newResult]);
        setCurrentView('results');
    };
   
    const handleExit = () => {
        setTestData(null);
        setUserAnswers({});
        setCurrentView('idle');
    }

    const latestResult = useMemo(() => {
        return performanceHistory.length > 0 ? performanceHistory[performanceHistory.length - 1] : null;
    }, [performanceHistory]);

    // --- MODIFIED: This is the new render logic ---
    if (currentView === 'idle') {
        return (
            <>
                {/* These styles apply to the IdleView */}
                <style>{`
                    /* --- ALL TEST-RELATED STYLES --- */
                    .test-overlay {
                      position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
                      background-color: #F9FAFB; z-index: 1000; display: flex;
                      align-items: center; justify-content: center; padding: 0;
                      box-sizing: border-box; animation: fadeIn 0.3s ease;
                    }
                    .test-feature-container {
                      background-color: #F9FAFB; width: 100%; height: 100%;
                      font-family: 'Montserrat', sans-serif; display: flex; flex-direction: column;
                      box-shadow: none; border-radius: 0; overflow-y: auto;
                      position: relative;
                    }
                    .test-exit-button {
                      position: absolute; top: 1rem; right: 1.5rem; background: none;
                      border: none; font-size: 2.5rem; line-height: 1; color: #9CA3AF;
                      cursor: pointer; z-index: 10; transition: color 0.2s ease;
                    }
                    .test-exit-button:hover { color: #1F2937; }
                    .test-idle-container {
                      display: flex; flex-direction: column; align-items: center;
                      justify-content: center; height: 100%; text-align: center;
                      padding: 1rem; background-color: #F9FAFB;
                    }
                    .test-idle-header {
                      font-size: 2rem; font-weight: 700; color: #1F2937; margin-bottom: 1rem;
                    }
                    .test-idle-p {
                      font-size: 1rem; color: #4B5563; margin-bottom: 2rem; max-width: 28rem;
                    }
                    .test-generate-button {
                      padding: 1rem 2rem; background-color: #2563EB; color: white;
                      font-weight: 600; border-radius: 0.5rem; border: none;
                      cursor: pointer; box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1);
                      transition: all 0.3s ease-in-out; font-size: 1rem;
                    }
                    .test-generate-button:hover { background-color: #1D4ED8; }
                    .test-generate-button:disabled { background-color: #93C5FD; cursor: not-allowed; }
                    .test-taking-container {
                      width: 100%; max-width: 1200px; margin: 0 auto; padding: 2rem 3rem;
                      display: flex; flex-direction: column; align-items: stretch;
                      box-sizing: border-box; background-color: transparent; min-height: 100%;
                    }
                    .test-results-container, .test-history-container {
                      width: 100%; max-width: 1200px; margin: 0 auto; padding: 2rem 3rem;
                      display: flex; flex-direction: column; box-sizing: border-box;
                      background-color: transparent; min-height: 100%;
                    }
                    .test-results-header, .test-history-header {
                      text-align: center; margin-bottom: 1.5rem; flex-shrink: 0; width: 100%;
                    }
                    .test-results-header h1, .test-history-header h1 {
                      font-size: 1.75rem; font-weight: 800; color: #1F2937; margin-bottom: 0;
                    }
                    .test-results-header p, .test-history-header p {
                      font-size: 1rem; color: #4B5563; margin-top: 0.25rem;
                    }
                    .test-results-grid {
                      flex-grow: 1; display: grid; grid-template-columns: 320px 1fr;
                      gap: 1.5rem; width: 100%;
                    }
                    .test-results-analysis-grid {
                      display: grid; grid-template-columns: repeat(2, 1fr);
                      grid-auto-rows: min-content; gap: 1.5rem;
                    }
                    .test-feedback-card {
                      background-color: white; padding: 1rem; border-radius: 1rem;
                      border: 1px solid #E5E7EB; display: flex; flex-direction: column;
                    }
                    .test-action-buttons-container {
                      margin-top: 1.5rem; padding-top: 1.5rem; padding-bottom: 1rem;
                      display: flex; gap: 1rem; justify-content: center;
                      flex-shrink: 0; width: 100%;
                    }
                    .test-history-kpi-grid {
                      display: grid; grid-template-columns: repeat(3, 1fr); gap: 1.5rem;
                      margin-bottom: 1.5rem; width: 100%; box-sizing: border-box; flex-shrink: 0;
                    }
                    .dashboard-content-area {
                      flex-grow: 1; display: grid; grid-template-columns: 320px 1fr;
                      gap: 1.5rem; width: 100%;
                    }
                    .performance-breakdown-card {
                      background-color: white; padding: 1rem; border-radius: 1rem;
                      border: 1px solid #E5E7EB; display: flex; flex-direction: column;
                      align-items: center;
                    }
                    .performance-breakdown-card h3 {
                      font-size: 1rem; font-weight: 700; color: #1F2937;
                    }
                    .category-cards-grid {
                      display: grid; grid-template-columns: repeat(2, 1fr);
                      grid-auto-rows: min-content; gap: 1.5rem;
                    }
                    .test-taking-header {
                      margin-bottom: 1.5rem; flex-shrink: 0; width: 100%;
                    }
                    .test-question-scroll-area {
                      flex-grow: 1; display: flex; flex-direction: column;
                      justify-content: center; overflow: hidden; width: 100%;
                    }
                    .test-question-category {
                      font-size: 0.875rem; font-weight: 600; color: #2563EB;
                    }
                    .test-question-title {
                      font-size: 1.25rem; font-weight: 700; color: #1F2937; margin-top: 0.25rem;
                    }
                    .test-progress-bar-background {
                      width: 100%; background-color: #E5E7EB; border-radius: 9999px;
                      height: 0.625rem; margin-top: 1rem;
                    }
                    .test-progress-bar-foreground {
                      background-color: #2563EB; height: 0.625rem; border-radius: 9999px;
                      transition: width 0.5s ease-in-out;
                    }
                    .test-question-card {
                      background-color: transparent; padding: 0; border: none; width: 100%;
                    }
                    .test-question-text {
                      font-size: 1.5rem; color: #111827; margin-bottom: 2.5rem;
                      font-weight: 600; line-height: 1.6;
                    }
                    .test-options-container {
                      display: grid; grid-template-columns: repeat(2, 1fr); gap: 1.5rem;
                    }
                    .test-option-button {
                      width: 100%; text-align: left; padding: 1.5rem; border-radius: 0.75rem;
                      border: 2px solid #D1D5DB; background-color: #FFFFFF;
                      transition: all 0.2s ease-in-out; cursor: pointer; font-family: inherit;
                      font-size: 1rem; min-height: 5rem; display: flex; align-items: center;
                      color: #1F2937; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.05), 0 2px 4px -2px rgb(0 0 0 / 0.05);
                    }
                    .test-option-button:hover, .test-option-button:focus {
                      background-color: #F9FAFB; border-color: #3B82F6;
                      transform: translateY(-2px); outline: none;
                    }
                    .test-option-button.selected {
                      background-color: #DBEAFE; border-color: #3B82F6;
                      box-shadow: 0 0 0 3px #BFDBFE;
                    }
                    .test-navigation-buttons {
                      display: flex; justify-content: space-between; align-items: center;
                      padding-top: 1.5rem; border-top: 1px solid #e5e7eb;
                      flex-shrink: 0; margin-top: 2rem; width: 100%;
                    }
                    .test-nav-button {
                      padding: 0.75rem 2rem; font-weight: 600; border-radius: 0.5rem;
                      box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05); border: 1px solid #D1D5DB;
                      background-color: white; color: #374151; cursor: pointer;
                      font-family: inherit; font-size: 1rem;
                    }
                    .test-nav-button:disabled { opacity: 0.5; cursor: not-allowed; }
                    .test-nav-button.exit {
                      background-color: transparent; color: #EF4444; border-color: #FCA5A5;
                    }
                    .test-nav-button.exit:hover { background-color: #FEF2F2; }
                    .test-nav-button.primary {
                      background-color: #2563EB; color: white; border-color: transparent;
                    }
                    .test-nav-button.primary:hover { background-color: #1D4ED8; }
                    .test-nav-button.finish {
                      background-color: #16A34A; color: white; border-color: transparent;
                    }
                    .test-nav-button.finish:hover { background-color: #15803D; }
                    .test-tooltip {
                      position: fixed; background-color: #111827; color: white;
                      font-size: 0.75rem; border-radius: 0.25rem; padding: 0.25rem 0.5rem;
                      pointer-events: none; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
                      z-index: 1050; transform: translate(10px, 10px);
                    }
                    .test-results-chart-column {
                      background-color: white; padding: 1rem; border-radius: 1rem;
                      border: 1px solid #E5E7EB; display: flex; flex-direction: column;
                      align-items: center; justify-content: center;
                    }
                    .test-results-chart-column h3 {
                      font-size: 1rem; font-weight: 700; color: #1F2937;
                    }
                    .test-results-subtitle {
                      font-size: 0.8rem; color: #6B7280; margin-bottom: 0.5rem; text-align: center;
                    }
                    .test-pie-chart-container {
                      position: relative; display: flex; align-items: center;
                      justify-content: center; margin-bottom: 1rem;
                    }
                    .test-pie-slice { transition: opacity 0.2s ease-in-out; }
                    .test-pie-slice:hover { opacity: 0.8; }
                    .test-legend-container {
                      width: 100%; display: flex; flex-direction: column; gap: 0.25rem;
                    }
                    .test-legend-item { display: flex; align-items: center; }
                    .test-legend-dot {
                      width: 0.75rem; height: 0.75rem; border-radius: 9999px; margin-right: 0.75rem;
                    }
                    .test-legend-label {
                      font-size: 0.875rem; color: #4B5563; font-weight: 500;
                    }
                    .test-legend-score {
                      margin-left: auto; font-weight: 600; color: #374151;
                    }
                    .cat-bg-blue { background-color: #60a5fa; }
                    .cat-bg-green { background-color: #4ade80; }
                    .cat-bg-red { background-color: #f87171; }
                    .cat-bg-yellow { background-color: #facc15; }
                    .test-feedback-score {
                      font-size: 1.25rem; font-weight: 700; color: #2563EB; margin: 0.25rem 0;
                    }
                    .test-feedback-analysis {
                      font-size: 0.875rem; color: #4B5563; margin-bottom: 0.75rem; line-height: 1.5;
                    }
                    .test-feedback-tips {
                      margin-top: auto; padding-top: 0.75rem; border-top: 1px solid #F3F4F6;
                    }
                    .test-feedback-tips h5 {
                      font-weight: 600; color: #374151; margin-bottom: 0.5rem; font-size: 0.875rem;
                    }
                    .test-feedback-tips ul {
                      list-style-type: disc; list-style-position: outside;
                      padding-left: 1.25rem; display: flex; flex-direction: column;
                      gap: 0.25rem; font-size: 0.875rem; color: #4B5563; margin: 0;
                    }
                    .test-action-button {
                      padding: 0.75rem 1.5rem; font-weight: 600; border-radius: 0.5rem;
                      transition: transform 0.2s ease-in-out, background-color 0.2s;
                      border: none; cursor: pointer; font-size: 1rem;
                    }
                    .test-action-button.primary {
                      background-color: #2563EB; color: white;
                      box-shadow: 0 4px 10px -3px rgb(0 0 0 / 0.1), 0 2px 4px -4px rgb(0 0 0 / 0.1);
                    }
                    .test-action-button.primary:hover {
                      background-color: #1D4ED8; transform: scale(1.05);
                    }
                    .test-action-button.secondary {
                      background-color: #E5E7EB; color: #374151;
                    }
                    .test-action-button.secondary:hover { background-color: #D1D5DB; }
                    .test-history-kpi-card {
                      background-color: #FFFFFF; padding: 1rem; border-radius: 1rem;
                      border: 1px solid #E5E7EB; text-align: center;
                    }
                    .test-history-kpi-card h4 {
                      font-size: 0.875rem; font-weight: 600; color: #4B5563; margin-bottom: 0.25rem;
                    }
                    .test-history-kpi-value {
                      font-size: 2rem; font-weight: 800; color: #1D4ED8; margin: 0;
                    }
                    .test-history-kpi-subtext {
                      font-size: 0.8rem; color: #6B7280; margin-top: 0.25rem;
                    }
                `}</style>
                <div className="test-feature-container">
                    <IdleView 
                        onGenerate={handleGenerateTest} 
                        loading={isLoading}
                        hasHistory={performanceHistory.length > 0}
                        onViewHistory={() => setCurrentView('history')}
                    />
                </div>
            </>
        );
    }
    
    return createPortal(
        <>
            {/* --- MOVED STYLES: This <style> block is new and contains all the styles --- */}
            <style>{`
                /* --- ALL TEST-RELATED STYLES --- */
                .test-overlay {
                  position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
                  background-color: #F9FAFB; z-index: 1000; display: flex;
                  align-items: center; justify-content: center; padding: 0;
                  box-sizing: border-box; animation: fadeIn 0.3s ease;
                }
                .test-feature-container {
                  background-color: #F9FAFB; width: 100%; height: 100%;
                  font-family: 'Montserrat', sans-serif; display: flex; flex-direction: column;
                  box-shadow: none; border-radius: 0; overflow-y: auto;
                  position: relative;
                }
                .test-exit-button {
                  position: absolute; top: 1rem; right: 1.5rem; background: none;
                  border: none; font-size: 2.5rem; line-height: 1; color: #9CA3AF;
                  cursor: pointer; z-index: 10; transition: color 0.2s ease;
                }
                .test-exit-button:hover { color: #1F2937; }
                .test-idle-container {
                  display: flex; flex-direction: column; align-items: center;
                  justify-content: center; height: 100%; text-align: center;
                  padding: 1rem; background-color: #F9FAFB;
                }
                .test-idle-header {
                  font-size: 2rem; font-weight: 700; color: #1F2937; margin-bottom: 1rem;
                }
                .test-idle-p {
                  font-size: 1rem; color: #4B5563; margin-bottom: 2rem; max-width: 28rem;
                }
                .test-generate-button {
                  padding: 1rem 2rem; background-color: #2563EB; color: white;
                  font-weight: 600; border-radius: 0.5rem; border: none;
                  cursor: pointer; box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1);
                  transition: all 0.3s ease-in-out; font-size: 1rem;
                }
                .test-generate-button:hover { background-color: #1D4ED8; }
                .test-generate-button:disabled { background-color: #93C5FD; cursor: not-allowed; }
                .test-taking-container {
                  width: 100%; max-width: 1200px; margin: 0 auto; padding: 2rem 3rem;
                  display: flex; flex-direction: column; align-items: stretch;
                  box-sizing: border-box; background-color: transparent; min-height: 100%;
                }
                .test-results-container, .test-history-container {
                  width: 100%; max-width: 1200px; margin: 0 auto; padding: 2rem 3rem;
                  display: flex; flex-direction: column; box-sizing: border-box;
                  background-color: transparent; min-height: 100%;
                }
                .test-results-header, .test-history-header {
                  text-align: center; margin-bottom: 1.5rem; flex-shrink: 0; width: 100%;
                }
                .test-results-header h1, .test-history-header h1 {
                  font-size: 1.75rem; font-weight: 800; color: #1F2937; margin-bottom: 0;
                }
                .test-results-header p, .test-history-header p {
                  font-size: 1rem; color: #4B5563; margin-top: 0.25rem;
                }
                .test-results-grid {
                  flex-grow: 1; display: grid; grid-template-columns: 320px 1fr;
                  gap: 1.5rem; width: 100%;
                }
                .test-results-analysis-grid {
                  display: grid; grid-template-columns: repeat(2, 1fr);
                  grid-auto-rows: min-content; gap: 1.5rem;
                }
                .test-feedback-card {
                  background-color: white; padding: 1rem; border-radius: 1rem;
                  border: 1px solid #E5E7EB; display: flex; flex-direction: column;
                }
                .test-action-buttons-container {
                  margin-top: 1.5rem; padding-top: 1.5rem; padding-bottom: 1rem;
                  display: flex; gap: 1rem; justify-content: center;
                  flex-shrink: 0; width: 100%;
                }
                .test-history-kpi-grid {
                  display: grid; grid-template-columns: repeat(3, 1fr); gap: 1.5rem;
                  margin-bottom: 1.5rem; width: 100%; box-sizing: border-box; flex-shrink: 0;
                }
                .dashboard-content-area {
                  flex-grow: 1; display: grid; grid-template-columns: 320px 1fr;
                  gap: 1.5rem; width: 100%;
                }
                .performance-breakdown-card {
                  background-color: white; padding: 1rem; border-radius: 1rem;
                  border: 1px solid #E5E7EB; display: flex; flex-direction: column;
                  align-items: center;
                }
                .performance-breakdown-card h3 {
                  font-size: 1rem; font-weight: 700; color: #1F2937;
                }
                .category-cards-grid {
                  display: grid; grid-template-columns: repeat(2, 1fr);
                  grid-auto-rows: min-content; gap: 1.5rem;
                }
                .test-taking-header {
                  margin-bottom: 1.5rem; flex-shrink: 0; width: 100%;
                }
                .test-question-scroll-area {
                  flex-grow: 1; display: flex; flex-direction: column;
                  justify-content: center; overflow: hidden; width: 100%;
                }
                .test-question-category {
                  font-size: 0.875rem; font-weight: 600; color: #2563EB;
                }
                .test-question-title {
                  font-size: 1.25rem; font-weight: 700; color: #1F2937; margin-top: 0.25rem;
                }
                .test-progress-bar-background {
                  width: 100%; background-color: #E5E7EB; border-radius: 9999px;
                  height: 0.625rem; margin-top: 1rem;
                }
                .test-progress-bar-foreground {
                  background-color: #2563EB; height: 0.625rem; border-radius: 9999px;
                  transition: width 0.5s ease-in-out;
                }
                .test-question-card {
                  background-color: transparent; padding: 0; border: none; width: 100%;
                }
                .test-question-text {
                  font-size: 1.5rem; color: #111827; margin-bottom: 2.5rem;
                  font-weight: 600; line-height: 1.6;
                }
                .test-options-container {
                  display: grid; grid-template-columns: repeat(2, 1fr); gap: 1.5rem;
                }
                .test-option-button {
                  width: 100%; text-align: left; padding: 1.5rem; border-radius: 0.75rem;
                  border: 2px solid #D1D5DB; background-color: #FFFFFF;
                  transition: all 0.2s ease-in-out; cursor: pointer; font-family: inherit;
                  font-size: 1rem; min-height: 5rem; display: flex; align-items: center;
                  color: #1F2937; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.05), 0 2px 4px -2px rgb(0 0 0 / 0.05);
                }
                .test-option-button:hover, .test-option-button:focus {
                  background-color: #F9FAFB; border-color: #3B82F6;
                  transform: translateY(-2px); outline: none;
                }
                .test-option-button.selected {
                  background-color: #DBEAFE; border-color: #3B82F6;
                  box-shadow: 0 0 0 3px #BFDBFE;
                }
                .test-navigation-buttons {
                  display: flex; justify-content: space-between; align-items: center;
                  padding-top: 1.5rem; border-top: 1px solid #e5e7eb;
                  flex-shrink: 0; margin-top: 2rem; width: 100%;
                }
                .test-nav-button {
                  padding: 0.75rem 2rem; font-weight: 600; border-radius: 0.5rem;
                  box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05); border: 1px solid #D1D5DB;
                  background-color: white; color: #374151; cursor: pointer;
                  font-family: inherit; font-size: 1rem;
                }
                .test-nav-button:disabled { opacity: 0.5; cursor: not-allowed; }
                .test-nav-button.exit {
                  background-color: transparent; color: #EF4444; border-color: #FCA5A5;
                }
                .test-nav-button.exit:hover { background-color: #FEF2F2; }
                .test-nav-button.primary {
                  background-color: #2563EB; color: white; border-color: transparent;
                }
                .test-nav-button.primary:hover { background-color: #1D4ED8; }
                .test-nav-button.finish {
                  background-color: #16A34A; color: white; border-color: transparent;
                }
                .test-nav-button.finish:hover { background-color: #15803D; }
                .test-tooltip {
                  position: fixed; background-color: #111827; color: white;
                  font-size: 0.75rem; border-radius: 0.25rem; padding: 0.25rem 0.5rem;
                  pointer-events: none; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
                  z-index: 1050; transform: translate(10px, 10px);
                }
                .test-results-chart-column {
                  background-color: white; padding: 1rem; border-radius: 1rem;
                  border: 1px solid #E5E7EB; display: flex; flex-direction: column;
                  align-items: center; justify-content: center;
                }
                .test-results-chart-column h3 {
                  font-size: 1rem; font-weight: 700; color: #1F2937;
                }
                .test-results-subtitle {
                  font-size: 0.8rem; color: #6B7280; margin-bottom: 0.5rem; text-align: center;
                }
                .test-pie-chart-container {
                  position: relative; display: flex; align-items: center;
                  justify-content: center; margin-bottom: 1rem;
                }
                .test-pie-slice { transition: opacity 0.2s ease-in-out; }
                .test-pie-slice:hover { opacity: 0.8; }
                .test-legend-container {
                  width: 100%; display: flex; flex-direction: column; gap: 0.25rem;
                }
                .test-legend-item { display: flex; align-items: center; }
                .test-legend-dot {
                  width: 0.75rem; height: 0.75rem; border-radius: 9999px; margin-right: 0.75rem;
                }
                .test-legend-label {
                  font-size: 0.875rem; color: #4B5563; font-weight: 500;
                }
                .test-legend-score {
                  margin-left: auto; font-weight: 600; color: #374151;
                }
                .cat-bg-blue { background-color: #60a5fa; }
                .cat-bg-green { background-color: #4ade80; }
                .cat-bg-red { background-color: #f87171; }
                .cat-bg-yellow { background-color: #facc15; }
                .test-feedback-score {
                  font-size: 1.25rem; font-weight: 700; color: #2563EB; margin: 0.25rem 0;
                }
                .test-feedback-analysis {
                  font-size: 0.875rem; color: #4B5563; margin-bottom: 0.75rem; line-height: 1.5;
                }
                .test-feedback-tips {
                  margin-top: auto; padding-top: 0.75rem; border-top: 1px solid #F3F4F6;
                }
                .test-feedback-tips h5 {
                  font-weight: 600; color: #374151; margin-bottom: 0.5rem; font-size: 0.875rem;
                }
                .test-feedback-tips ul {
                  list-style-type: disc; list-style-position: outside;
                  padding-left: 1.25rem; display: flex; flex-direction: column;
                  gap: 0.25rem; font-size: 0.875rem; color: #4B5563; margin: 0;
                }
                .test-action-button {
                  padding: 0.75rem 1.5rem; font-weight: 600; border-radius: 0.5rem;
                  transition: transform 0.2s ease-in-out, background-color 0.2s;
                  border: none; cursor: pointer; font-size: 1rem;
                }
                .test-action-button.primary {
                  background-color: #2563EB; color: white;
                  box-shadow: 0 4px 10px -3px rgb(0 0 0 / 0.1), 0 2px 4px -4px rgb(0 0 0 / 0.1);
                }
                .test-action-button.primary:hover {
                  background-color: #1D4ED8; transform: scale(1.05);
                }
                .test-action-button.secondary {
                  background-color: #E5E7EB; color: #374151;
                }
                .test-action-button.secondary:hover { background-color: #D1D5DB; }
                .test-history-kpi-card {
                  background-color: #FFFFFF; padding: 1rem; border-radius: 1rem;
                  border: 1px solid #E5E7EB; text-align: center;
                }
                .test-history-kpi-card h4 {
                  font-size: 0.875rem; font-weight: 600; color: #4B5563; margin-bottom: 0.25rem;
                }
                .test-history-kpi-value {
                  font-size: 2rem; font-weight: 800; color: #1D4ED8; margin: 0;
                }
                .test-history-kpi-subtext {
                  font-size: 0.8rem; color: #6B7280; margin-top: 0.25rem;
                }
            `}</style>
            <div className="test-overlay">
                <div className="test-feature-container">
                    <button className="test-exit-button" onClick={handleExit}>&times;</button>
                    {currentView === 'takingTest' && testData && (
                        <TakingTestView
                            testData={testData}
                            userAnswers={userAnswers}
                            onAnswerSelect={handleAnswerSelect}
                            onFinish={handleFinishTest}
                            onExit={handleExit}
                        />
                    )}
                    {currentView === 'results' && latestResult && (
                        <ResultsView
                            result={latestResult}
                            onRetake={handleGenerateTest}
                            onViewHistory={() => setCurrentView('history')}
                        />
                    )}
                    {currentView === 'history' && (
                        <HistoryView
                            overallScores={overallPerformance}
                            history={performanceHistory}
                            onBack={() => setCurrentView('idle')}
                            onRetake={handleGenerateTest}
                        />
                    )}
                </div>
            </div>
        </>,
        document.body
    );
};

export default TestFeature;