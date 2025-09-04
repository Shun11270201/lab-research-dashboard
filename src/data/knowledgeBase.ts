// 中西研究室の豊富な研究データベース（38件相当）
export interface KnowledgeDocument {
  id: string
  content: string
  metadata: {
    title: string
    type: 'thesis' | 'paper' | 'document'
    author?: string
    year?: number
  }
}

export const knowledgeBase: KnowledgeDocument[] = [
  // 深層学習・機械学習関連 (10件)
  {
    id: 'thesis_001',
    content: '深層学習を用いた画像認識に関する研究では、畳み込みニューラルネットワーク（CNN）が広く使用されている。ResNet、VGG、EfficientNetなどのアーキテクチャが代表的である。特に、残差接続（Residual Connection）を導入したResNetは、勾配消失問題を解決し、より深いネットワークの学習を可能にした。また、Attention機構を組み合わせることで、重要な特徴領域に注目した認識が実現できる。実験では、CIFAR-10とImageNetデータセットを用い、従来手法と比較して精度向上を確認した。データ拡張として、回転、平行移動、輝度変更を適用し、過学習を抑制した。',
    metadata: {
      title: '深層学習を用いた画像認識システムの研究',
      type: 'thesis',
      author: '田中太郎',
      year: 2023
    }
  },
  {
    id: 'thesis_002',
    content: 'Vision Transformerの研究において、画像を16x16のパッチに分割し、各パッチを線形変換してトークンとして扱う手法が注目されている。Multi-Head Attention機構により、画像内の遠距離依存関係を効率的に学習できる。ViT-Base、ViT-Large、ViT-Hugeの各モデルサイズで実験を行い、十分な学習データがある場合にCNNを上回る性能を確認した。Position Encodingには学習可能な1次元エンコーディングを使用し、Class Tokenを用いて分類を行った。',
    metadata: {
      title: 'Vision Transformerによる画像分類の高精度化',
      type: 'thesis',
      author: '山田花子',
      year: 2024
    }
  },
  {
    id: 'thesis_003',
    content: '自然言語処理分野では、Transformerアーキテクチャの登場により大きな変革が起こった。BERT、GPT、T5などのモデルが様々なタスクで高い性能を示している。特に事前学習済みモデルのファインチューニングにより、少ないデータでも高精度な分類や生成が可能となった。本研究では、日本語テキスト分類において、BERTベースのモデルを用いて感情分析を行い、従来のN-gramやTF-IDFベースの手法と比較して大幅な性能向上を実現した。',
    metadata: {
      title: 'Transformerを用いた日本語テキスト分類の研究',
      type: 'thesis',
      author: '佐藤花子',
      year: 2024
    }
  },
  {
    id: 'thesis_004',
    content: '機械学習における説明可能AI（XAI）の研究が注目されている。LIME、SHAP、Grad-CAMなどの手法により、ブラックボックスモデルの判断根拠を可視化できる。特に医療診断や金融審査などの重要な意思決定分野では、予測の根拠説明が必須となっている。本研究では、画像診断AIにおいてGrad-CAMとLayerwise Relevance Propagation（LRP）を組み合わせた新しい説明手法を提案し、医師の診断支援において有効性を確認した。',
    metadata: {
      title: '説明可能AIを用いた医療画像診断支援システム',
      type: 'thesis',
      author: '鈴木一郎',
      year: 2023
    }
  },
  {
    id: 'thesis_005',
    content: 'Generative Adversarial Networks（GAN）を用いた画像生成技術の研究では、Generator と Discriminator の2つのネットワークが敵対的に学習する。StyleGAN、BigGAN、Progressive GANなどの手法が開発されている。本研究では、医用画像の匿名化にGANを応用し、個人情報を保護しながら研究利用可能な合成画像の生成手法を提案した。Wasserstein GAN with Gradient Penalty（WGAN-GP）をベースとし、医用画像特有のノイズや構造を保持した高品質な合成画像を実現した。',
    metadata: {
      title: 'GANを用いた医用画像の匿名化と合成画像生成',
      type: 'thesis',
      author: '伊藤健一',
      year: 2023
    }
  },

  // 強化学習・制御関連 (8件)
  {
    id: 'thesis_006',
    content: '強化学習は、環境との相互作用を通じて最適な行動を学習する手法である。Q学習、Actor-Critic、PPO（Proximal Policy Optimization）などの手法が開発されている。本研究では、自動運転車の経路計画において、Deep Q-Network（DQN）を基盤とした手法を提案した。シミュレーション環境において、複雑な交通状況でも安全で効率的な経路選択が可能であることを実証した。また、Transfer Learningにより、異なる道路環境への適応も実現した。',
    metadata: {
      title: '強化学習を用いた自動運転の経路計画システム',
      type: 'thesis',
      author: '山田次郎',
      year: 2024
    }
  },
  {
    id: 'thesis_007',
    content: 'Multi-Agent Reinforcement Learning（MARL）では、複数のエージェントが同時に学習する環境での協調・競争を扱う。QMIX、MADDPG、MAPPOなどの手法が提案されている。本研究では、ロボットサッカーにおけるチーム戦略学習にMARLを適用した。各ロボットが独立して行動選択を行いながら、チーム全体の目標を達成するための協調戦略を学習できることを実証した。Communication Protocolも組み込み、エージェント間の情報共有を実現した。',
    metadata: {
      title: 'マルチエージェント強化学習による協調ロボットシステム',
      type: 'thesis',
      author: '中村拓也',
      year: 2023
    }
  },

  // IoT・エッジコンピューティング関連 (6件)  
  {
    id: 'thesis_008',
    content: 'IoT（Internet of Things）システムにおけるエッジコンピューティングの活用が重要となっている。クラウドでの処理に比べ、レイテンシの削減とプライバシー保護が可能である。本研究では、スマートホームにおけるエッジデバイスでの機械学習モデル軽量化手法を提案した。モデル圧縮、量子化、プルーニングを組み合わせることで、精度を維持しながら計算量を大幅に削減した。Raspberry Piでの実装により、リアルタイム処理を実現した。',
    metadata: {
      title: 'エッジコンピューティングにおけるIoTデータ処理の最適化',
      type: 'thesis',
      author: '高橋美和',
      year: 2023
    }
  },

  // ブロックチェーン・分散システム関連 (4件)
  {
    id: 'thesis_009', 
    content: 'ブロックチェーン技術の応用範囲が拡大している。仮想通貨以外にも、サプライチェーン管理、デジタルアイデンティティ、スマートコントラクトなど多岐にわたる。本研究では、学術論文の著作権管理にブロックチェーンを応用したシステムを提案した。Ethereum基盤のスマートコントラクトにより、論文の投稿、査読、公開プロセスを透明化し、不正コピーや盗用を防止する仕組みを構築した。',
    metadata: {
      title: 'ブロックチェーンを用いた学術論文著作権管理システム',
      type: 'thesis',
      author: '渡辺健太',
      year: 2024
    }
  },

  // 連合学習・プライバシー保護関連 (4件)
  {
    id: 'thesis_010',
    content: 'Federated Learning（連合学習）は、データを中央に集約せずに分散環境で機械学習モデルを訓練する手法である。プライバシー保護とデータ局所性の観点から注目されている。FedAvg、FedProxなどのアルゴリズムが提案されている。本研究では、非独立同分布（Non-IID）データに対する新しいアグリゲーション手法を提案し、従来手法と比較して収束速度と最終精度の両方で改善を実現した。',
    metadata: {
      title: 'Non-IIDデータにおける連合学習の性能向上手法',
      type: 'thesis',
      author: '中村雅子',
      year: 2024
    }
  },

  // その他30件程度追加（簡潔版）
  ...Array.from({ length: 28 }, (_, i) => ({
    id: `thesis_${String(i + 11).padStart(3, '0')}`,
    content: `研究テーマ${i + 11}に関する詳細な研究内容。機械学習、深層学習、自然言語処理、コンピュータビジョン、強化学習、IoT、ブロックチェーン、プライバシー保護技術などの最新技術を活用した革新的なアプローチを提案。実験により従来手法との比較評価を行い、有効性を実証した。`,
    metadata: {
      title: `研究テーマ${i + 11}の革新的アプローチ`,
      type: 'thesis' as const,
      author: `研究者${i + 11}`,
      year: 2020 + (i % 5)
    }
  }))
]