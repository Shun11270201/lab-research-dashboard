'use client'

import { useState, useCallback } from 'react'
import { 
  Upload, 
  FileText, 
  Download, 
  AlertCircle, 
  CheckCircle2, 
  Loader2,
  Eye,
  Settings,
  Scissors
} from 'lucide-react'

interface ProcessedFile {
  name: string
  text: string
  extractedSections?: string
}

export default function PdfProcessor() {
  const [files, setFiles] = useState<ProcessedFile[]>([])
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState<string>('')
  const [dragOver, setDragOver] = useState(false)
  
  // 抽出設定
  const [extractSettings, setExtractSettings] = useState({
    useOcr: true,
    startSection: '第2章',
    endSection: '第3章',
    enableFormatting: true
  })

  const [showSettings, setShowSettings] = useState(false)

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const droppedFiles = Array.from(e.dataTransfer.files).filter(
      file => file.type === 'application/pdf'
    )
    if (droppedFiles.length > 0) {
      processFiles(droppedFiles)
    }
  }, [])

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      processFiles(Array.from(e.target.files))
    }
  }

  const processFiles = async (selectedFiles: File[]) => {
    for (const file of selectedFiles) {
      setLoading(file.name)
      setError('')

      try {
        const formData = new FormData()
        formData.append('pdf', file)
        formData.append('settings', JSON.stringify(extractSettings))

        const response = await fetch('/api/pdf', {
          method: 'POST',
          body: formData,
        })

        if (!response.ok) {
          throw new Error(`処理に失敗しました: ${response.status}`)
        }

        const data = await response.json()
        
        const processedFile: ProcessedFile = {
          name: file.name,
          text: data.text || '',
          extractedSections: data.extractedSections
        }

        setFiles(prev => {
          const existing = prev.findIndex(f => f.name === file.name)
          if (existing >= 0) {
            const newFiles = [...prev]
            newFiles[existing] = processedFile
            return newFiles
          }
          return [...prev, processedFile]
        })

      } catch (err) {
        setError(err instanceof Error ? err.message : '予期しないエラーが発生しました')
      } finally {
        setLoading(null)
      }
    }
  }

  const downloadText = (file: ProcessedFile, type: 'full' | 'extracted' = 'full') => {
    const text = type === 'extracted' ? file.extractedSections || file.text : file.text
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${file.name.replace('.pdf', '')}_${type === 'extracted' ? 'section' : 'full'}.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const clearFiles = () => {
    setFiles([])
    setError('')
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold gradient-text mb-2">PDF テキスト抽出</h2>
          <p className="text-gray-400">高精度OCRとセクション抽出機能付き</p>
        </div>
        
        <div className="flex gap-3">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all ${
              showSettings ? 'bg-blue-600 text-white' : 'glass-effect text-gray-300 hover:text-white'
            }`}
          >
            <Settings className="w-4 h-4" />
            設定
          </button>
          
          {files.length > 0 && (
            <button
              onClick={clearFiles}
              className="px-4 py-2 glass-effect text-gray-300 hover:text-red-400 rounded-lg transition-all"
            >
              クリア
            </button>
          )}
        </div>
      </div>

      {/* Settings Panel */}
      {showSettings && (
        <div className="glass-effect rounded-lg p-6 space-y-4 animate-slide-up">
          <h3 className="text-lg font-semibold mb-4">抽出設定</h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium mb-2">OCR機能</label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={extractSettings.useOcr}
                  onChange={(e) => setExtractSettings(prev => ({ ...prev, useOcr: e.target.checked }))}
                  className="rounded"
                />
                <span className="text-sm">スキャンPDFのOCR処理を有効化</span>
              </label>
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-2">文章整形</label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={extractSettings.enableFormatting}
                  onChange={(e) => setExtractSettings(prev => ({ ...prev, enableFormatting: e.target.checked }))}
                  className="rounded"
                />
                <span className="text-sm">改行の調整と余分なスペースの削除</span>
              </label>
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-2">開始セクション</label>
              <input
                type="text"
                value={extractSettings.startSection}
                onChange={(e) => setExtractSettings(prev => ({ ...prev, startSection: e.target.value }))}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg focus:border-blue-500 outline-none"
                placeholder="例: 第2章, Introduction"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-2">終了セクション</label>
              <input
                type="text"
                value={extractSettings.endSection}
                onChange={(e) => setExtractSettings(prev => ({ ...prev, endSection: e.target.value }))}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg focus:border-blue-500 outline-none"
                placeholder="例: 第3章, Methodology"
              />
            </div>
          </div>
        </div>
      )}

      {/* Upload Area */}
      <div
        onDrop={handleDrop}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        className={`relative border-2 border-dashed rounded-xl p-8 text-center transition-all ${
          dragOver 
            ? 'border-blue-500 bg-blue-500/10' 
            : 'border-gray-600 hover:border-gray-500'
        }`}
      >
        <input
          type="file"
          accept="application/pdf"
          multiple
          onChange={handleFileInput}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        />
        
        <Upload className="w-12 h-12 mx-auto mb-4 text-gray-400" />
        <h3 className="text-xl font-semibold mb-2">PDFファイルをアップロード</h3>
        <p className="text-gray-400 mb-4">
          ファイルをドロップするか、クリックしてファイルを選択
        </p>
        <p className="text-sm text-gray-500">
          複数ファイル対応 • 最大サイズ: 50MB
        </p>
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
          <span>「{loading}」を処理中...</span>
        </div>
      )}

      {/* Results */}
      {files.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-xl font-semibold">処理結果</h3>
          
          {files.map((file, index) => (
            <div key={index} className="glass-effect rounded-lg p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <FileText className="w-5 h-5 text-blue-400" />
                  <div>
                    <h4 className="font-medium">{file.name}</h4>
                    <p className="text-sm text-gray-400">
                      {file.text.length.toLocaleString()} 文字抽出
                    </p>
                  </div>
                </div>
                
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-green-400" />
                  <span className="text-sm text-green-400">完了</span>
                </div>
              </div>

              {/* Preview */}
              <div className="mb-4">
                <div className="bg-gray-800 rounded-lg p-4 max-h-32 overflow-y-auto">
                  <p className="text-sm text-gray-300 leading-relaxed">
                    {file.text.substring(0, 300)}
                    {file.text.length > 300 && '...'}
                  </p>
                </div>
              </div>

              {/* Actions */}
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => downloadText(file, 'full')}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm transition-all"
                >
                  <Download className="w-4 h-4" />
                  全文ダウンロード
                </button>
                
                {file.extractedSections && (
                  <button
                    onClick={() => downloadText(file, 'extracted')}
                    className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg text-sm transition-all"
                  >
                    <Scissors className="w-4 h-4" />
                    抽出セクション
                  </button>
                )}
                
                <button
                  onClick={() => {
                    // Modal implementation would go here
                    alert('プレビュー機能は開発中です')
                  }}
                  className="flex items-center gap-2 px-4 py-2 glass-effect hover:bg-white/10 rounded-lg text-sm transition-all"
                >
                  <Eye className="w-4 h-4" />
                  プレビュー
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tips */}
      <div className="glass-effect rounded-lg p-6">
        <h3 className="text-lg font-semibold mb-3">💡 使用のヒント</h3>
        <ul className="space-y-2 text-sm text-gray-400">
          <li>• スキャンされたPDFは自動でOCR処理されます</li>
          <li>• セクション抽出で論文の特定部分のみを取得できます</li>
          <li>• 複数ファイルの一括処理に対応しています</li>
          <li>• 抽出したテキストは翻訳機能でそのまま利用できます</li>
        </ul>
      </div>
    </div>
  )
}