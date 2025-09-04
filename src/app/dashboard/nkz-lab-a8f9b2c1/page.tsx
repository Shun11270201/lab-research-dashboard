'use client'

import { useState } from 'react'
import { 
  FileText, 
  Languages, 
  MessageCircle, 
  Upload,
  BookOpen,
  Sparkles,
  ArrowRight,
  Brain,
  Zap
} from 'lucide-react'
import PdfProcessor from '@/components/PdfProcessor'
import TranslationService from '@/components/TranslationService'
import ChatBotInterface from '@/components/ChatBotInterface'

type ActiveTab = 'overview' | 'pdf' | 'translate' | 'chat'

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('overview')

  const menuItems = [
    {
      id: 'overview' as const,
      icon: Sparkles,
      label: 'ダッシュボード',
      description: '全機能の概要'
    },
    {
      id: 'pdf' as const,
      icon: FileText,
      label: 'PDF処理',
      description: 'テキスト抽出・OCR'
    },
    {
      id: 'translate' as const,
      icon: Languages,
      label: '論文翻訳',
      description: '英→日翻訳・要約'
    },
    {
      id: 'chat' as const,
      icon: MessageCircle,
      label: 'RAG ChatBot',
      description: '過去研究からAI回答'
    }
  ]

  const features = [
    {
      icon: Upload,
      title: 'PDF テキスト抽出',
      description: '高精度OCR機能付きで論文PDFからテキストを抽出',
      color: 'from-blue-500 to-cyan-500'
    },
    {
      icon: Languages,
      title: '論文翻訳・要約',
      description: 'GPT-4を使用した英語論文の日本語翻訳と要約生成',
      color: 'from-purple-500 to-pink-500'
    },
    {
      icon: Brain,
      title: 'RAG ChatBot',
      description: '過去の卒論・修論を学習したAIアシスタント',
      color: 'from-green-500 to-emerald-500'
    },
    {
      icon: BookOpen,
      title: '研究資料管理',
      description: '研究室の論文やドキュメントを一元管理',
      color: 'from-orange-500 to-red-500'
    }
  ]

  const renderContent = () => {
    switch (activeTab) {
      case 'overview':
        return (
          <div className="space-y-8 animate-fade-in">
            {/* Hero Section */}
            <div className="text-center py-12 px-6">
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-blue-500/10 border border-blue-500/20 rounded-full mb-6">
                <Zap className="w-4 h-4 text-blue-400" />
                <span className="text-sm text-blue-300">中西研究室専用システム</span>
              </div>
              
              <h1 className="text-5xl font-bold mb-4 gradient-text">
                Research Dashboard
              </h1>
              <p className="text-xl text-gray-400 max-w-2xl mx-auto mb-8">
                研究効率を最大化する統合ダッシュボード
              </p>
              
              <div className="flex flex-wrap justify-center gap-4">
                <button 
                  onClick={() => setActiveTab('pdf')}
                  className="flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg transition-all hover-glow"
                >
                  <FileText className="w-5 h-5" />
                  PDF処理を開始
                  <ArrowRight className="w-4 h-4" />
                </button>
                <button 
                  onClick={() => setActiveTab('translate')}
                  className="flex items-center gap-2 px-6 py-3 bg-purple-600 hover:bg-purple-700 rounded-lg transition-all hover-glow"
                >
                  <Languages className="w-5 h-5" />
                  論文翻訳
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Features Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {features.map((feature, index) => (
                <div 
                  key={index}
                  className="glass-effect rounded-xl p-6 hover-glow transition-all duration-300 hover:scale-105"
                >
                  <div className={`w-12 h-12 rounded-lg bg-gradient-to-r ${feature.color} flex items-center justify-center mb-4`}>
                    <feature.icon className="w-6 h-6 text-white" />
                  </div>
                  <h3 className="text-xl font-semibold mb-2">{feature.title}</h3>
                  <p className="text-gray-400 leading-relaxed">{feature.description}</p>
                </div>
              ))}
            </div>

            {/* Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="glass-effect rounded-xl p-6 text-center">
                <div className="text-3xl font-bold text-blue-400 mb-2">∞</div>
                <div className="text-gray-400">処理可能ファイル数</div>
              </div>
              <div className="glass-effect rounded-xl p-6 text-center">
                <div className="text-3xl font-bold text-purple-400 mb-2">4+</div>
                <div className="text-gray-400">対応言語数</div>
              </div>
              <div className="glass-effect rounded-xl p-6 text-center">
                <div className="text-3xl font-bold text-green-400 mb-2">24/7</div>
                <div className="text-gray-400">AI利用可能</div>
              </div>
            </div>
          </div>
        )
      case 'pdf':
        return <PdfProcessor />
      case 'translate':
        return <TranslationService />
      case 'chat':
        return <ChatBotInterface />
      default:
        return null
    }
  }

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside className="w-80 glass-effect border-r border-white/10 flex flex-col">
        {/* Logo */}
        <div className="p-6 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold">中西研究室</h1>
              <p className="text-sm text-gray-400">Research Dashboard</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-2">
          {menuItems.map((item) => {
            const Icon = item.icon
            const isActive = activeTab === item.id
            
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-all ${
                  isActive 
                    ? 'bg-blue-600 text-white shadow-lg' 
                    : 'text-gray-300 hover:bg-white/5 hover:text-white'
                }`}
              >
                <Icon className="w-5 h-5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium">{item.label}</div>
                  <div className="text-xs opacity-75 truncate">{item.description}</div>
                </div>
              </button>
            )
          })}
        </nav>

        {/* Version Info */}
        <div className="p-4 border-t border-white/10">
          <div className="text-xs text-gray-500">
            <div>Version 1.0.0</div>
            <div className="mt-1">Last updated: {new Date().toLocaleDateString('ja-JP')}</div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        <div className="p-8 max-w-6xl mx-auto">
          {renderContent()}
        </div>
      </main>
    </div>
  )
}