'use client'

import { useState, useRef, useEffect } from 'react'
import { 
  MessageCircle, 
  Send, 
  Upload, 
  Brain, 
  Loader2, 
  User, 
  Bot,
  FileText,
  Search,
  Sparkles,
  RefreshCw,
  Settings,
  Database,
  AlertCircle
} from 'lucide-react'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  sources?: string[]
}

interface KnowledgeBase {
  id: string
  name: string
  type: 'thesis' | 'paper' | 'document'
  uploadedAt: Date
  status: 'processing' | 'ready' | 'error'
}

export default function ChatBotInterface() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'assistant',
      content: 'こんにちは！中西研究室のRAG ChatBotです。\n\n📚 **既に読み込み済みの研究資料（39件）：**\n・深層学習（CNN、ResNet、EfficientNet、Vision Transformer）\n・自然言語処理（Transformer、BERT、GPT、感情分析）\n・説明可能AI（LIME、SHAP、Grad-CAM、LRP、医療診断）\n・強化学習（Q学習、DQN、PPO、マルチエージェント）\n・IoT・エッジコンピューティング（モデル軽量化、量子化）\n・ブロックチェーン（スマートコントラクト、Ethereum）\n・連合学習（FedAvg、Non-IID、プライバシー保護）\n・Graph Neural Network（GCN、GraphSAGE、GAT）\n・その他多数の先端研究テーマ\n\n📖 これらの豊富な研究資料について、お気軽に質問してください！具体的な手法、実験結果、実装詳細まで詳しく説明いたします。',
      timestamp: new Date(),
    }
  ])
  
  const [inputMessage, setInputMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [knowledgeBase, setKnowledgeBase] = useState<KnowledgeBase[]>([])
  const [showSettings, setShowSettings] = useState(false)
  const [searchMode, setSearchMode] = useState<'semantic' | 'keyword'>('semantic')
  
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    // Load existing knowledge base on mount
    loadKnowledgeBase()
  }, [])

  const loadKnowledgeBase = async () => {
    try {
      const response = await fetch('/api/knowledge-base')
      if (response.ok) {
        const data = await response.json()
        setKnowledgeBase(data.documents || [])
      }
    } catch (error) {
      console.error('Failed to load knowledge base:', error)
    }
  }

  const handleSendMessage = async () => {
    if (!inputMessage.trim()) return

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: inputMessage,
      timestamp: new Date()
    }

    setMessages(prev => [...prev, userMessage])
    setInputMessage('')
    setLoading(true)

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: inputMessage,
          searchMode,
          history: messages.slice(-10) // Send last 10 messages for context
        })
      })

      if (!response.ok) {
        throw new Error('Chat response failed')
      }

      const data = await response.json()
      
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.response,
        timestamp: new Date(),
        sources: data.sources
      }

      setMessages(prev => [...prev, assistantMessage])

    } catch (error) {
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: '申し訳ありませんが、エラーが発生しました。もう一度お試しください。',
        timestamp: new Date()
      }
      setMessages(prev => [...prev, errorMessage])
    } finally {
      setLoading(false)
    }
  }

  const handleFileUpload = async (files: FileList) => {
    for (const file of Array.from(files)) {
      const newDoc: KnowledgeBase = {
        id: Date.now().toString() + file.name,
        name: file.name,
        type: file.name.includes('卒論') ? 'thesis' : 
               file.name.includes('修論') ? 'thesis' : 
               file.name.includes('.pdf') ? 'paper' : 'document',
        uploadedAt: new Date(),
        status: 'processing'
      }
      
      setKnowledgeBase(prev => [...prev, newDoc])

      try {
        const formData = new FormData()
        formData.append('file', file)
        
        const response = await fetch('/api/knowledge-base/upload', {
          method: 'POST',
          body: formData
        })

        if (response.ok) {
          setKnowledgeBase(prev => prev.map(doc => 
            doc.id === newDoc.id ? { ...doc, status: 'ready' } : doc
          ))
        } else {
          throw new Error('Upload failed')
        }
      } catch (error) {
        setKnowledgeBase(prev => prev.map(doc => 
          doc.id === newDoc.id ? { ...doc, status: 'error' } : doc
        ))
      }
    }
  }

  const clearChat = () => {
    setMessages([{
      id: '1',
      role: 'assistant',
      content: 'チャットがクリアされました。新しい質問をどうぞ！',
      timestamp: new Date(),
    }])
  }

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'thesis': return Brain
      case 'paper': return FileText
      default: return FileText
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'ready': return 'text-green-400'
      case 'processing': return 'text-yellow-400'
      case 'error': return 'text-red-400'
      default: return 'text-gray-400'
    }
  }

  const formatMessage = (content: string) => {
    // Simple markdown-like formatting
    return content
      .split('\n')
      .map((line, index) => {
        if (line.startsWith('##')) {
          return <h3 key={index} className="text-lg font-semibold mt-3 mb-1">{line.replace('##', '').trim()}</h3>
        }
        if (line.startsWith('- ')) {
          return <li key={index} className="ml-4">{line.replace('- ', '• ')}</li>
        }
        if (line.trim()) {
          return <p key={index} className="mb-2">{line}</p>
        }
        return <br key={index} />
      })
  }

  return (
    <div className="h-full flex flex-col animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between p-6 border-b border-white/10">
        <div>
          <h2 className="text-3xl font-bold gradient-text mb-2">RAG ChatBot</h2>
          <p className="text-gray-400">過去の研究資料を学習したAIアシスタント</p>
        </div>
        
        <div className="flex gap-3">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all ${
              showSettings ? 'bg-green-600 text-white' : 'glass-effect text-gray-300 hover:text-white'
            }`}
          >
            <Settings className="w-4 h-4" />
            設定
          </button>
          
          <button
            onClick={clearChat}
            className="flex items-center gap-2 px-4 py-2 glass-effect text-gray-300 hover:text-white rounded-lg transition-all"
          >
            <RefreshCw className="w-4 h-4" />
            クリア
          </button>
        </div>
      </div>

      <div className="flex-1 flex">
        {/* Chat Area */}
        <div className="flex-1 flex flex-col">
          {/* Settings Panel */}
          {showSettings && (
            <div className="p-6 glass-effect border-b border-white/10 animate-slide-up">
              <h3 className="text-lg font-semibold mb-4">検索設定</h3>
              
              <div className="flex gap-4">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    checked={searchMode === 'semantic'}
                    onChange={() => setSearchMode('semantic')}
                    className="text-green-500"
                  />
                  <span className="text-sm">セマンティック検索（意味理解）</span>
                </label>
                
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    checked={searchMode === 'keyword'}
                    onChange={() => setSearchMode('keyword')}
                    className="text-green-500"
                  />
                  <span className="text-sm">キーワード検索（高速）</span>
                </label>
              </div>
            </div>
          )}

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {message.role === 'assistant' && (
                  <div className="w-8 h-8 bg-gradient-to-r from-green-500 to-emerald-600 rounded-full flex items-center justify-center flex-shrink-0">
                    <Bot className="w-5 h-5 text-white" />
                  </div>
                )}
                
                <div className={`max-w-2xl ${message.role === 'user' ? 'order-first' : ''}`}>
                  <div
                    className={`rounded-lg p-4 ${
                      message.role === 'user'
                        ? 'bg-blue-600 text-white ml-auto'
                        : 'glass-effect'
                    }`}
                  >
                    <div className="prose prose-sm max-w-none text-inherit">
                      {formatMessage(message.content)}
                    </div>
                    
                    {message.sources && message.sources.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-white/10">
                        <p className="text-xs text-gray-400 mb-2">参考資料:</p>
                        <div className="flex flex-wrap gap-1">
                          {message.sources.map((source, index) => (
                            <span
                              key={index}
                              className="px-2 py-1 bg-white/10 rounded text-xs text-gray-300"
                            >
                              {source}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  
                  <p className="text-xs text-gray-500 mt-1 px-2">
                    {message.timestamp.toLocaleTimeString('ja-JP')}
                  </p>
                </div>
                
                {message.role === 'user' && (
                  <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center flex-shrink-0">
                    <User className="w-5 h-5 text-white" />
                  </div>
                )}
              </div>
            ))}
            
            {loading && (
              <div className="flex gap-3 justify-start">
                <div className="w-8 h-8 bg-gradient-to-r from-green-500 to-emerald-600 rounded-full flex items-center justify-center">
                  <Bot className="w-5 h-5 text-white" />
                </div>
                <div className="glass-effect rounded-lg p-4 flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-sm">回答を生成中...</span>
                </div>
              </div>
            )}
            
            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <div className="p-6 border-t border-white/10">
            <div className="flex gap-3">
              <div className="flex-1 relative">
                <input
                  type="text"
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
                  placeholder="研究に関する質問を入力してください..."
                  className="w-full px-4 py-3 bg-gray-800 border border-gray-600 rounded-lg focus:border-green-500 outline-none pr-12"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-white transition-colors"
                >
                  <Upload className="w-5 h-5" />
                </button>
              </div>
              
              <button
                onClick={handleSendMessage}
                disabled={!inputMessage.trim() || loading}
                className="px-6 py-3 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 rounded-lg transition-all flex items-center gap-2"
              >
                <Send className="w-5 h-5" />
                送信
              </button>
            </div>
            
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.txt,.md"
              onChange={(e) => e.target.files && handleFileUpload(e.target.files)}
              className="hidden"
            />
          </div>
        </div>

        {/* Knowledge Base Sidebar */}
        <div className="w-80 border-l border-white/10 glass-effect">
          <div className="p-4 border-b border-white/10">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Database className="w-5 h-5 text-green-400" />
              知識ベース
            </h3>
            <p className="text-sm text-gray-400 mt-1">
              学習済み資料: {knowledgeBase.filter(doc => doc.status === 'ready').length}件
            </p>
          </div>
          
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {knowledgeBase.length === 0 ? (
              <div className="text-center py-8 text-gray-400">
                <Database className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p className="text-sm">まだ資料が登録されていません</p>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="mt-3 text-sm text-green-400 hover:text-green-300"
                >
                  資料を追加する
                </button>
              </div>
            ) : (
              knowledgeBase.map((doc) => {
                const Icon = getTypeIcon(doc.type)
                return (
                  <div key={doc.id} className="glass-effect rounded-lg p-3">
                    <div className="flex items-start gap-2">
                      <Icon className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{doc.name}</p>
                        <p className={`text-xs ${getStatusColor(doc.status)}`}>
                          {doc.status === 'ready' && '✓ 利用可能'}
                          {doc.status === 'processing' && '⏳ 処理中'}
                          {doc.status === 'error' && '❌ エラー'}
                        </p>
                        <p className="text-xs text-gray-500 mt-1">
                          {doc.uploadedAt.toLocaleDateString('ja-JP')}
                        </p>
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
          
          <div className="p-4 border-t border-white/10">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 glass-effect hover:bg-white/10 rounded-lg transition-all"
            >
              <Upload className="w-4 h-4" />
              資料を追加
            </button>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="p-4 border-t border-white/10 bg-gray-900/50">
        <div className="flex flex-wrap gap-2">
          {[
            "過去の卒論で使われた手法を教えて",
            "この研究分野の最新動向は？",
            "参考文献の推薦をお願いします",
            "研究のアプローチ方法について相談したい"
          ].map((suggestion, index) => (
            <button
              key={index}
              onClick={() => setInputMessage(suggestion)}
              className="px-3 py-2 text-xs glass-effect hover:bg-white/10 rounded-full transition-all text-gray-300 hover:text-white"
            >
              {suggestion}
            </button>
          ))}
        </div>
      </div>

      {/* Tips */}
      <div className="p-4 glass-effect border-t border-white/10">
        <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-green-400" />
          💡 使用のヒント
        </h4>
        <ul className="text-xs text-gray-400 space-y-1">
          <li>• 具体的な研究テーマや手法について質問してください</li>
          <li>• 過去の論文や研究資料を参照した回答を提供します</li>
          <li>• PDFファイルを追加して知識ベースを拡充できます</li>
        </ul>
      </div>
    </div>
  )
}