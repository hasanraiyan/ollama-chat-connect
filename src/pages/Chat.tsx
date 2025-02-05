import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Preferences } from '@capacitor/preferences';
import { useToast } from "@/components/ui/use-toast";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'; // Use vscDarkPlus theme (or choose another)


interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface LocalModel {
  name: string;
  modified_at: string;
  size: number;
  digest: string;
  details: any;
}


const Chat = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [serverUrl, setServerUrl] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [localModels, setLocalModels] = useState<LocalModel[]>([]);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    loadServerConfig();
  }, []);


  const fetchLocalModels = async (url: string) => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await fetch(`${url}/api/tags`, {
        headers: {
          'Accept': 'application/json',
        }
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch local models: ${response.status}`);
      }
      const data = await response.json();
      if (data && data.models) {
        console.log("Available local models:", data.models);
        setLocalModels(data.models);
        return data.models;
      } else {
        console.warn("No models data received from /api/tags endpoint.");
        return [];
      }
    } catch (error) {
      console.error("Error fetching local models:", error);
      setError(`Unable to connect to Ollama server or fetch models. Please ensure:\n1. Ollama server is running (ollama serve --cors)\n2. Server URL is correct and accessible\n3. Check server logs for errors if issues persist.\n4. The server URL in settings matches your Ollama server`);
      toast({
        title: "Error",
        description: "Unable to fetch list of local models from server. Check server URL and Ollama server status.",
        variant: "destructive",
      });
      return [];
    } finally {
      setIsLoading(false);
    }
  };


  const loadServerConfig = async () => {
    try {
      const { value: url } = await Preferences.get({ key: 'ollama_server_url' });
      const { value: model } = await Preferences.get({ key: 'ollama_model' });

      if (!url || !model) {
        navigate('/settings');
        toast({
          title: "Configuration Required",
          description: "Please set up your Ollama server and model first.",
          variant: "destructive",
        });
        return;
      }

      const finalUrl = window.location.protocol === 'https:'
        ? url.replace('http:', 'https:')
        : url;

      setServerUrl(finalUrl);


      const fetchedModels = await fetchLocalModels(finalUrl);

      if (fetchedModels.length > 0) {
        setSelectedModel(model);
        setError(null);
      } else {
        if (!error) {
          setError("Could not retrieve model list from server.");
        }
      }


    } catch (error) {
      console.error('Error loading config:', error);
      setError('Failed to load configuration. Please check settings and server connection.');
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || !serverUrl || !selectedModel) return;

    const userMessage: Message = { role: 'user', content: input.trim() };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    setError(null);

    let assistantMessageContent = "";

    try {
      console.log('Sending request to:', serverUrl);
      const response = await fetch(`${serverUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          model: selectedModel,
          messages: messages.concat(userMessage),
          stream: true // Enable streaming
        }),
      });

      if (!response.ok || !response.body) {
        setIsLoading(false);
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while(true) {
        const { done, value } = await reader.read();
        if (done) {
          console.log('Stream finished');
          break;
        }
        const chunk = decoder.decode(value);
        const lines = chunk.split('\n').filter(line => line.trim() !== '');

        for (const line of lines) {
          try {
            const parsedData = JSON.parse(line);
            if (parsedData.message && parsedData.message.content) {
              assistantMessageContent += parsedData.message.content;
              setMessages(prevMessages => {
                const updatedMessages = [...prevMessages];
                const lastMessage = updatedMessages[updatedMessages.length - 1];
                if (lastMessage && lastMessage.role === 'assistant' && !lastMessage.content.startsWith(assistantMessageContent)) {
                  updatedMessages[updatedMessages.length - 1] = { ...lastMessage, content: assistantMessageContent };
                  return updatedMessages;
                } else if (!lastMessage || lastMessage.role !== 'assistant') {
                  updatedMessages.push({ role: 'assistant', content: assistantMessageContent });
                  return updatedMessages;
                }
                return prevMessages;
              });
            }
            if (parsedData.done) {
              console.log('Full response received');
              setIsLoading(false);
              return;
            }
          } catch (e) {
            console.error('Error parsing stream chunk:', e, line);
            continue;
          }
        }
      }


    } catch (error) {
      setIsLoading(false);
      console.error('Error during sendMessage:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      setError(errorMessage);
      toast({
        title: "Error",
        description: "Failed to get response from Ollama server. Check console for details.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleModelSelect = (modelName: string) => {
    setSelectedModel(modelName);
    Preferences.set({ key: 'ollama_model', value: modelName });
    toast({
      title: "Model Changed",
      description: `Model switched to ${modelName}`,
    });
  };


  return (
    <div className="flex flex-col h-screen bg-gradient-to-b from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      {/* Header */}
      <div className="flex justify-between items-center p-4 backdrop-blur-lg bg-white/80 dark:bg-gray-800/80 border-b border-gray-200 dark:border-gray-700">
        <h1 className="text-xl font-semibold text-gray-800 dark:text-gray-200">
          Chat with AI
        </h1>

        {/* Model Selection Dropdown */}
        {localModels.length > 0 && (
          <Select onValueChange={handleModelSelect} value={selectedModel}>
            <SelectTrigger className="w-[180px] md:w-[220px] mr-2">
              <SelectValue placeholder="Select a Model" />
            </SelectTrigger>
            <SelectContent>
              {localModels.map((model) => (
                <SelectItem key={model.name} value={model.name}>{model.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Settings Button */}
        <button
          onClick={() => navigate('/settings')}
          className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        >
          <svg
            className="w-6 h-6 text-gray-600 dark:text-gray-300"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
        </button>
      </div>

      {/* Error Alert */}
      {error && (
        <Alert variant="destructive" className="m-4">
          <AlertTitle>Connection Error</AlertTitle>
          <AlertDescription className="whitespace-pre-line">
            {error}
          </AlertDescription>
        </Alert>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((message, index) => (
          <div
            key={index}
            className={`flex ${
              message.role === 'user' ? 'justify-end' : 'justify-start'
            }`}
          >
            <div
              className={`max-w-[80%] p-4 rounded-2xl backdrop-blur-sm ${
                message.role === 'user'
                  ? 'bg-mint-500/10 dark:bg-mint-500/20'
                  : 'bg-white/80 dark:bg-gray-800/80'
              } shadow-sm`}
            >
              {message.role === 'assistant' ? (
                <ReactMarkdown
                  className="text-gray-800 dark:text-gray-200 prose dark:prose-invert"
                  rehypePlugins={[rehypeRaw]}
                  remarkPlugins={[remarkGfm]}
                  components={{
                    code({node, inline, className, children, ...props}) {
                      const match = /language-(\w+)/.exec(className || '')
                      return !inline && match ? (
                        <SyntaxHighlighter
                          children={String(children).replace(/\n$/, '')}
                          style={vscDarkPlus}
                          language={match[1]}
                          PreTag="div"
                          // showLineNumbers={true} // Enable line numbers if desired
                          {...props}
                        />
                      ) : (
                        <code className={className} {...props}>
                          {children}
                        </code>
                      )
                    },
                    // Example: Customizing headings (optional)
                    h1: ({node, ...props}) => <h1 className="text-2xl font-bold text-blue-500" {...props} />,
                    h2: ({node, ...props}) => <h2 className="text-xl font-semibold text-blue-500" {...props} />,
                    h3: ({node, ...props}) => <h3 className="text-lg font-medium text-blue-500" {...props} />,
                    h4: ({node, ...props}) => <h4 className="text-base font-semibold text-blue-500" {...props} />,
                    h5: ({node, ...props}) => <h5 className="text-sm font-semibold text-blue-500" {...props} />,
                    h6: ({node, ...props}) => <h6 className="text-xs font-semibold text-blue-500" {...props} />,

                  }}
                >
                  {message.content}
                </ReactMarkdown>
              ) : (
                <p className="text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
                  {message.content}
                </p>
              )}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="max-w-[80%] p-4 rounded-2xl bg-white/80 dark:bg-gray-800/80 shadow-sm backdrop-blur-sm">
              <div className="flex space-x-2">
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-100" />
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-200" />
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input and Send */}
      <div className="p-4 backdrop-blur-lg bg-white/80 dark:bg-gray-800/80 border-t border-gray-200 dark:border-gray-700">
        <div className="flex space-x-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
            placeholder="Type your message..."
            className="flex-1 p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-gray-700/50 backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-mint-500 dark:text-white"
          />
          <button
            onClick={sendMessage}
            disabled={isLoading || !input.trim()}
            className="p-3 rounded-xl bg-mint-500 text-white hover:bg-mint-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
};

export default Chat;