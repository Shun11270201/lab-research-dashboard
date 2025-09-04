'use client'

import { useState } from 'react'
import { 
  Languages, 
  Upload, 
  Zap, 
  Download, 
  FileText, 
  AlertCircle, 
  CheckCircle2, 
  Loader2,
  Settings,
  Sparkles,
  BookOpen
} from 'lucide-react'

interface TranslationJob {
  id: string
  fileName: string
  originalText: string
  translatedText: string
  summary: string
  status: 'processing' | 'completed' | 'error'
  settings: TranslationSettings
  createdAt: Date
}

interface TranslationSettings {
  targetLanguage: string
  includesSummary: boolean
  customPrompt: string
  model: string
}

export default function TranslationService() {
  const [jobs, setJobs] = useState<TranslationJob[]>([])
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState<string>('')
  const [inputText, setInputText] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  
  const [settings, setSettings] = useState<TranslationSettings>({
    targetLanguage: '日本語',
    includesSummary: true,
    customPrompt: 'この論文の「背景・目的」「手法」「結果・結論」を明確に分け、日本語で箇条書きでまとめてください。',
    model: 'gpt-4o'
  })

  const languages = [
    '日本語', '英語', '中国語', '韓国語', 'ドイツ語', 'フランス語', 'スペイン語', 'イタリア語'
  ]

  const models = [
    { id: 'gpt-4o', name: 'GPT-4o (最新・高精度)', description: '最も高性能なモデル' },
    { id: 'gpt-4-turbo', name: 'GPT-4 Turbo (バランス)', description: '速度と精度のバランス' },
    { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo (高速)', description: '高速処理向け' }
  ]

  const handleFileUpload = async (file: File) => {
    setLoading(file.name)
    setError('')

    try {
      // ファイル検証
      console.log('File info:', {
        name: file.name,
        size: file.size,
        type: file.type,
        lastModified: new Date(file.lastModified).toISOString()
      })

      if (file.size === 0) {
        throw new Error('ファイルが空です。有効なPDFファイルを選択してください。')
      }

      if (file.size > 50 * 1024 * 1024) { // 50MB制限
        throw new Error('ファイルサイズが大きすぎます（50MB以下にしてください）。')
      }

      if (!file.type.includes('pdf') && !file.name.toLowerCase().endsWith('.pdf')) {
        throw new Error('PDFファイルを選択してください。')
      }

      // PDFからテキストを抽出
      const formData = new FormData()
      formData.append('pdf', file)
      
      const extractResponse = await fetch('/api/pdf', {
        method: 'POST',
        body: formData,
      })

      if (!extractResponse.ok) {
        const errorData = await extractResponse.json().catch(() => ({ error: 'Response parsing failed' }))
        console.error('PDF processing error:', errorData)
        console.error('Full response:', {
          status: extractResponse.status,
          statusText: extractResponse.statusText,
          headers: Object.fromEntries(extractResponse.headers.entries())
        })
        
        const errorMessage = errorData.error || `HTTPエラー: ${extractResponse.status} ${extractResponse.statusText}`
        throw new Error(`PDFの処理に失敗しました: ${errorMessage}`)
      }

      const { text } = await extractResponse.json()
      
      if (!text || text.trim().length === 0) {
        throw new Error('PDFからテキストを抽出できませんでした。テキストが含まれているPDFファイルを使用してください。')
      }
      
      // 翻訳処理を開始
      await processTranslation(file.name, text)
      
    } catch (err) {
      setError(err instanceof Error ? err.message : '予期しないエラーが発生しました')
    } finally {
      setLoading(null)
    }
  }

  const processTranslation = async (fileName: string, text: string) => {
    const jobId = Date.now().toString()
    
    // ジョブを追加
    const newJob: TranslationJob = {
      id: jobId,
      fileName,
      originalText: text,
      translatedText: '',
      summary: '',
      status: 'processing',
      settings: { ...settings },
      createdAt: new Date()
    }
    
    setJobs(prev => [newJob, ...prev])

    try {
      const response = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          settings
        })
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        console.error('Translation API error:', errorData)
        throw new Error(`翻訳処理に失敗しました: ${errorData.error || 'Unknown error'}`)
      }

      const result = await response.json()
      
      // ジョブを更新
      setJobs(prev => prev.map(job => 
        job.id === jobId 
          ? { 
              ...job, 
              translatedText: result.translation,
              summary: result.summary,
              status: 'completed' as const
            }
          : job
      ))

    } catch (err) {
      setJobs(prev => prev.map(job => 
        job.id === jobId 
          ? { ...job, status: 'error' as const }
          : job
      ))
      setError(err instanceof Error ? err.message : '翻訳に失敗しました')
    }
  }

  const handleTextTranslation = async () => {
    if (!inputText.trim()) {
      setError('翻訳するテキストを入力してください')
      return
    }

    await processTranslation('直接入力', inputText)
    setInputText('')
  }

  const downloadResult = (job: TranslationJob, type: 'translation' | 'summary' | 'both') => {
    let content = ''
    let filename = ''

    switch (type) {
      case 'translation':
        content = job.translatedText
        filename = `${job.fileName}_translation.txt`
        break
      case 'summary':
        content = job.summary
        filename = `${job.fileName}_summary.txt`
        break
      case 'both':
        content = `# ${job.fileName} - 翻訳結果\n\n## 概要\n\n${job.summary}\n\n---\n\n## 全文翻訳\n\n${job.translatedText}`
        filename = `${job.fileName}_complete.md`
        break
    }

    const blob = new Blob([content], { type: type === 'both' ? 'text/markdown' : 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const clearJobs = () => {
    setJobs([])
    setError('')
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold gradient-text mb-2">論文翻訳・要約</h2>
          <p className="text-gray-400">GPT-4による高精度翻訳と自動要約生成</p>
        </div>
        
        <div className="flex gap-3">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all ${
              showSettings ? 'bg-purple-600 text-white' : 'glass-effect text-gray-300 hover:text-white'
            }`}
          >
            <Settings className="w-4 h-4" />
            設定
          </button>
          
          {jobs.length > 0 && (
            <button
              onClick={clearJobs}
              className="px-4 py-2 glass-effect text-gray-300 hover:text-red-400 rounded-lg transition-all"
            >
              履歴クリア
            </button>
          )}
        </div>
      </div>

      {/* Settings Panel */}
      {showSettings && (
        <div className="glass-effect rounded-lg p-6 space-y-6 animate-slide-up">
          <h3 className="text-lg font-semibold mb-4">翻訳設定</h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium mb-2">翻訳先言語</label>
              <select
                value={settings.targetLanguage}
                onChange={(e) => setSettings(prev => ({ ...prev, targetLanguage: e.target.value }))}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg focus:border-purple-500 outline-none"
              >
                {languages.map(lang => (
                  <option key={lang} value={lang}>{lang}</option>
                ))}
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-2">AIモデル</label>
              <select
                value={settings.model}
                onChange={(e) => setSettings(prev => ({ ...prev, model: e.target.value }))}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg focus:border-purple-500 outline-none"
              >
                {models.map(model => (
                  <option key={model.id} value={model.id}>{model.name}</option>
                ))}
              </select>
              <p className="text-xs text-gray-400 mt-1">
                {models.find(m => m.id === settings.model)?.description}
              </p>
            </div>
          </div>
          
          <div>
            <label className="flex items-center gap-2 mb-3">
              <input
                type="checkbox"
                checked={settings.includesSummary}
                onChange={(e) => setSettings(prev => ({ ...prev, includesSummary: e.target.checked }))}
                className="rounded"
              />
              <span className="text-sm font-medium">要約も生成する</span>
            </label>
            
            {settings.includesSummary && (
              <div>
                <label className="block text-sm font-medium mb-2">要約の指示</label>
                <textarea
                  value={settings.customPrompt}
                  onChange={(e) => setSettings(prev => ({ ...prev, customPrompt: e.target.value }))}
                  rows={3}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg focus:border-purple-500 outline-none resize-none"
                  placeholder="要約に関する具体的な指示を入力..."
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Input Methods */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* File Upload */}
        <div className="glass-effect rounded-lg p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Upload className="w-5 h-5 text-purple-400" />
            PDFファイルから翻訳
          </h3>
          
          <input
            type="file"
            accept="application/pdf"
            onChange={(e) => e.target.files && handleFileUpload(e.target.files[0])}
            className="file-input-container"
          />
          
          <div className="file-input-label">
            <FileText className="w-8 h-8 text-gray-400 mb-2" />
            <span className="text-sm">PDFファイルを選択</span>
          </div>
        </div>

        {/* Text Input */}
        <div className="glass-effect rounded-lg p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Languages className="w-5 h-5 text-purple-400" />
            テキスト直接入力
          </h3>
          
          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            rows={4}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg focus:border-purple-500 outline-none resize-none mb-4"
            placeholder="翻訳したいテキストを直接入力..."
          />
          
          <button
            onClick={handleTextTranslation}
            disabled={!inputText.trim() || loading !== null}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 rounded-lg transition-all"
          >
            <Zap className="w-4 h-4" />
            翻訳開始
          </button>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="flex items-center gap-2 p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Processing Status */}
      {loading && (
        <div className="flex items-center gap-2 p-4 glass-effect rounded-lg">
          <div className="w-5 h-5 spinner" />
          <span>「{loading}」を翻訳中...</span>
        </div>
      )}

      {/* Translation Results */}
      {jobs.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-xl font-semibold flex items-center gap-2">
            <BookOpen className="w-5 h-5" />
            翻訳履歴
          </h3>
          
          {jobs.map((job) => (
            <div key={job.id} className="glass-effect rounded-lg p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <Languages className="w-5 h-5 text-purple-400" />
                  <div>
                    <h4 className="font-medium">{job.fileName}</h4>
                    <p className="text-sm text-gray-400">
                      {job.createdAt.toLocaleString('ja-JP')} • {job.settings.targetLanguage}
                    </p>
                  </div>
                </div>
                
                <div className="flex items-center gap-2">
                  {job.status === 'processing' && (
                    <>
                      <div className="w-5 h-5 spinner" />
                      <span className="text-sm text-yellow-400">処理中</span>
                    </>
                  )}
                  {job.status === 'completed' && (
                    <>
                      <CheckCircle2 className="w-5 h-5 text-green-400" />
                      <span className="text-sm text-green-400">完了</span>
                    </>
                  )}
                  {job.status === 'error' && (
                    <>
                      <AlertCircle className="w-5 h-5 text-red-400" />
                      <span className="text-sm text-red-400">エラー</span>
                    </>
                  )}
                </div>
              </div>

              {job.status === 'completed' && (
                <div className="space-y-4">
                  {/* Summary Preview */}
                  {job.summary && (
                    <div>
                      <h5 className="text-sm font-medium text-purple-400 mb-2">📝 要約</h5>
                      <div className="bg-gray-800 rounded-lg p-4 max-h-32 overflow-y-auto">
                        <p className="text-sm text-gray-300 leading-relaxed">
                          {job.summary.substring(0, 200)}
                          {job.summary.length > 200 && '...'}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Translation Preview */}
                  <div>
                    <h5 className="text-sm font-medium text-blue-400 mb-2">🌐 翻訳結果</h5>
                    <div className="bg-gray-800 rounded-lg p-4 max-h-32 overflow-y-auto">
                      <p className="text-sm text-gray-300 leading-relaxed">
                        {job.translatedText.substring(0, 200)}
                        {job.translatedText.length > 200 && '...'}
                      </p>
                    </div>
                  </div>

                  {/* Download Actions */}
                  <div className="flex flex-wrap gap-2 pt-2">
                    <button
                      onClick={() => downloadResult(job, 'both')}
                      className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg text-sm transition-all"
                    >
                      <Download className="w-4 h-4" />
                      完全版ダウンロード
                    </button>
                    
                    {job.summary && (
                      <button
                        onClick={() => downloadResult(job, 'summary')}
                        className="flex items-center gap-2 px-4 py-2 glass-effect hover:bg-white/10 rounded-lg text-sm transition-all"
                      >
                        <Sparkles className="w-4 h-4" />
                        要約のみ
                      </button>
                    )}
                    
                    <button
                      onClick={() => downloadResult(job, 'translation')}
                      className="flex items-center gap-2 px-4 py-2 glass-effect hover:bg-white/10 rounded-lg text-sm transition-all"
                    >
                      <Languages className="w-4 h-4" />
                      翻訳のみ
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Usage Tips */}
      <div className="glass-effect rounded-lg p-6">
        <h3 className="text-lg font-semibold mb-3">💡 使用のヒント</h3>
        <ul className="space-y-2 text-sm text-gray-400">
          <li>• GPT-4oは最高品質の翻訳を提供しますが、処理時間が長くなります</li>
          <li>• 長い論文は自動的にセクション分けして段階的に翻訳されます</li>
          <li>• 要約の指示をカスタマイズして、必要な情報を重点的に抽出できます</li>
          <li>• PDF処理機能で抽出したテキストをそのまま翻訳に使用できます</li>
        </ul>
      </div>
    </div>
  )
}