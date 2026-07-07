-- EYE Agência — schema SQLite (espelha prisma/schema.prisma)
-- Booleans = INTEGER 0/1 · timestamps = TEXT ISO-8601 · ids = TEXT

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS Cliente (
  id          TEXT PRIMARY KEY,
  nome        TEXT NOT NULL,
  segmento    TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'em_dia',
  corPrimaria TEXT NOT NULL DEFAULT '#E11D2A',
  createdAt   TEXT NOT NULL,
  updatedAt   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS Unidade (
  id        TEXT PRIMARY KEY,
  clienteId TEXT NOT NULL REFERENCES Cliente(id) ON DELETE CASCADE,
  nome      TEXT NOT NULL,
  tipo      TEXT NOT NULL DEFAULT 'secretaria',
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ClienteDNA (
  id              TEXT PRIMARY KEY,
  clienteId       TEXT NOT NULL UNIQUE REFERENCES Cliente(id) ON DELETE CASCADE,
  configurado     INTEGER NOT NULL DEFAULT 0,
  posicionamento  TEXT NOT NULL DEFAULT '',
  tomDeVoz        TEXT NOT NULL DEFAULT '',
  paletaJson      TEXT NOT NULL DEFAULT '[]',
  tipografiaJson  TEXT NOT NULL DEFAULT '{}',
  referenciasJson TEXT NOT NULL DEFAULT '[]',
  frameworksJson  TEXT NOT NULL DEFAULT '[]',
  proibicoesJson  TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS "User" (
  id            TEXT PRIMARY KEY,
  nome          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  senhaHash     TEXT NOT NULL,
  role          TEXT NOT NULL,
  clienteId     TEXT REFERENCES Cliente(id),
  unidadeId     TEXT REFERENCES Unidade(id),
  gestorCliente INTEGER NOT NULL DEFAULT 0,
  avatarColor   TEXT NOT NULL DEFAULT '#E11D2A',
  ativo         INTEGER NOT NULL DEFAULT 1,
  mustChangePassword INTEGER NOT NULL DEFAULT 0,
  createdAt     TEXT NOT NULL,
  updatedAt     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS Solicitacao (
  id                   TEXT PRIMARY KEY,
  clienteId            TEXT NOT NULL REFERENCES Cliente(id) ON DELETE CASCADE,
  unidadeId            TEXT REFERENCES Unidade(id),
  solicitanteId        TEXT NOT NULL REFERENCES "User"(id),
  tipo                 TEXT NOT NULL,                 -- arte | video
  titulo               TEXT NOT NULL,
  descricao            TEXT NOT NULL DEFAULT '',
  prioridade           TEXT NOT NULL DEFAULT 'normal',
  prazoDesejado        TEXT,
  status               TEXT NOT NULL DEFAULT 'rascunho',
  formato              TEXT,                          -- arte
  textosDesejados      TEXT,
  informacoes          TEXT,
  tipoVideo            TEXT,                          -- video
  localGravacao        TEXT,
  dataEvento           TEXT,
  precisaEquipeNoLocal INTEGER NOT NULL DEFAULT 0,
  roteiroNecessario    INTEGER NOT NULL DEFAULT 0,
  -- cobertura de evento
  horaEvento           TEXT,
  tipoCobertura        TEXT,                          -- reels | reels_fotos | reels_fotos_stories
  coberturaReels       INTEGER NOT NULL DEFAULT 0,
  coberturaFotos       INTEGER NOT NULL DEFAULT 0,
  coberturaStories     INTEGER NOT NULL DEFAULT 0,
  tipoReels            TEXT,                          -- informativo | evento
  motivoReprovacao     TEXT,
  createdAt            TEXT NOT NULL,
  updatedAt            TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS Anexo (
  id            TEXT PRIMARY KEY,
  solicitacaoId TEXT NOT NULL REFERENCES Solicitacao(id) ON DELETE CASCADE,
  categoria     TEXT NOT NULL DEFAULT 'referencia',   -- referencia | entrega
  nomeArquivo   TEXT NOT NULL,
  url           TEXT NOT NULL,
  mime          TEXT NOT NULL DEFAULT '',
  tamanho       INTEGER NOT NULL DEFAULT 0,
  createdAt     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS Tarefa (
  id              TEXT PRIMARY KEY,
  solicitacaoId   TEXT NOT NULL UNIQUE REFERENCES Solicitacao(id) ON DELETE CASCADE,
  tipo            TEXT NOT NULL,
  titulo          TEXT NOT NULL,
  responsavelId   TEXT REFERENCES "User"(id),
  prazoProducao   TEXT,
  statusProducao  TEXT NOT NULL DEFAULT 'roteiro',
  entregaUrl      TEXT,
  promptSugerido  TEXT,
  legendaSugerida TEXT,
  createdAt       TEXT NOT NULL,
  updatedAt       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS EventoAgenda (
  id            TEXT PRIMARY KEY,
  clienteId     TEXT NOT NULL REFERENCES Cliente(id) ON DELETE CASCADE,
  solicitacaoId TEXT REFERENCES Solicitacao(id),
  titulo        TEXT NOT NULL,
  dataHora      TEXT NOT NULL,
  plataforma    TEXT,
  tipo          TEXT NOT NULL DEFAULT 'post',
  status        TEXT NOT NULL DEFAULT 'rascunho', -- rascunho|aguardando_confirmacao|confirmado|postado
  legenda       TEXT NOT NULL DEFAULT '',
  imagemUrl     TEXT,
  hashtags      TEXT NOT NULL DEFAULT '',
  criadoPorId   TEXT REFERENCES "User"(id),
  postarPorId   TEXT REFERENCES "User"(id),
  createdAt     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_evento_cliente ON EventoAgenda(clienteId);
CREATE INDEX IF NOT EXISTS idx_evento_status  ON EventoAgenda(status);

CREATE TABLE IF NOT EXISTS Campanha (
  id          TEXT PRIMARY KEY,
  clienteId   TEXT NOT NULL REFERENCES Cliente(id) ON DELETE CASCADE,
  nome        TEXT NOT NULL,
  plataforma  TEXT NOT NULL DEFAULT 'meta',
  objetivo    TEXT NOT NULL DEFAULT 'conversao',
  verba       REAL NOT NULL DEFAULT 0,
  gasto       REAL NOT NULL DEFAULT 0,
  inicio      TEXT NOT NULL,
  fim         TEXT,
  status      TEXT NOT NULL DEFAULT 'ativa',
  metricsJson TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS Notificacao (
  id             TEXT PRIMARY KEY,
  destinatarioId TEXT REFERENCES "User"(id),
  clienteId      TEXT,
  solicitacaoId  TEXT REFERENCES Solicitacao(id),
  titulo         TEXT NOT NULL,
  mensagem       TEXT NOT NULL DEFAULT '',
  canal          TEXT NOT NULL DEFAULT 'interno',
  lida           INTEGER NOT NULL DEFAULT 0,
  createdAt      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS HistoricoEvento (
  id            TEXT PRIMARY KEY,
  solicitacaoId TEXT REFERENCES Solicitacao(id) ON DELETE CASCADE,
  autorId       TEXT REFERENCES "User"(id),
  acao          TEXT NOT NULL,
  de            TEXT,
  para          TEXT,
  detalhe       TEXT,
  createdAt     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_solic_cliente ON Solicitacao(clienteId);
CREATE INDEX IF NOT EXISTS idx_solic_status  ON Solicitacao(status);
CREATE INDEX IF NOT EXISTS idx_unidade_cli   ON Unidade(clienteId);
CREATE INDEX IF NOT EXISTS idx_hist_solic    ON HistoricoEvento(solicitacaoId);
CREATE INDEX IF NOT EXISTS idx_notif_dest    ON Notificacao(destinatarioId);

-- v2: rastreio de SLA por etapa
CREATE TABLE IF NOT EXISTS TransicaoStatus (
  id            TEXT PRIMARY KEY,
  solicitacaoId TEXT NOT NULL REFERENCES Solicitacao(id) ON DELETE CASCADE,
  status        TEXT NOT NULL,
  responsavelId TEXT REFERENCES "User"(id),
  iniciadoEm    TEXT NOT NULL,
  finalizadoEm  TEXT
);

CREATE INDEX IF NOT EXISTS idx_transicao_solic ON TransicaoStatus(solicitacaoId);

-- v2: agenda de vídeo com videomaker e local (idempotente via tratamento de erro no exec())
ALTER TABLE EventoAgenda ADD COLUMN responsavelId TEXT REFERENCES "User"(id);
ALTER TABLE EventoAgenda ADD COLUMN localEvento TEXT;

-- v3: integração com Instagram Graph API
CREATE TABLE IF NOT EXISTS InstagramConexao (
  id              TEXT PRIMARY KEY,
  clienteId       TEXT NOT NULL UNIQUE REFERENCES Cliente(id) ON DELETE CASCADE,
  instagramUserId TEXT NOT NULL,
  username        TEXT NOT NULL,
  accessToken     TEXT NOT NULL,
  tokenExpiraEm   TEXT NOT NULL,
  conectadoEm     TEXT NOT NULL,
  ultimaSincEm    TEXT
);

CREATE TABLE IF NOT EXISTS InstagramMetrica (
  id            TEXT PRIMARY KEY,
  clienteId     TEXT NOT NULL REFERENCES Cliente(id) ON DELETE CASCADE,
  coletadoEm    TEXT NOT NULL,
  seguidores    INTEGER NOT NULL DEFAULT 0,
  seguindo      INTEGER NOT NULL DEFAULT 0,
  totalPosts    INTEGER NOT NULL DEFAULT 0,
  alcanceSemana INTEGER,
  impressoesSem INTEGER,
  visitasPerfil INTEGER
);

CREATE INDEX IF NOT EXISTS idx_igmetrica_cliente ON InstagramMetrica(clienteId, coletadoEm);

-- v4: Motor de Marketing Autônomo
ALTER TABLE EventoAgenda ADD COLUMN roteiro TEXT;
ALTER TABLE EventoAgenda ADD COLUMN geradoPorIA INTEGER NOT NULL DEFAULT 0;
ALTER TABLE EventoAgenda ADD COLUMN justificativa TEXT;
ALTER TABLE EventoAgenda ADD COLUMN formato TEXT;
ALTER TABLE EventoAgenda ADD COLUMN objetivo TEXT;

CREATE TABLE IF NOT EXISTS GeracaoMarketing (
  id           TEXT PRIMARY KEY,
  clienteId    TEXT NOT NULL REFERENCES Cliente(id) ON DELETE CASCADE,
  mes          TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'processando',
  totalItens   INTEGER NOT NULL DEFAULT 0,
  itensGerados INTEGER NOT NULL DEFAULT 0,
  erros        INTEGER NOT NULL DEFAULT 0,
  iniciadoEm   TEXT NOT NULL,
  concluidoEm  TEXT
);

CREATE INDEX IF NOT EXISTS idx_geracao_cli ON GeracaoMarketing(clienteId);

-- v5: disparo de notificação WhatsApp no horário da postagem
ALTER TABLE EventoAgenda ADD COLUMN notificadoDisparo INTEGER NOT NULL DEFAULT 0;

-- v6: entrega de vídeo por link externo (Google Drive / WeTransfer / Dropbox)
ALTER TABLE Tarefa ADD COLUMN videoLink TEXT;
ALTER TABLE Tarefa ADD COLUMN videoLinkTipo TEXT;

-- v7: assets de identidade visual do cliente (logos + referências para a IA)
CREATE TABLE IF NOT EXISTS ClienteAsset (
  id        TEXT PRIMARY KEY,
  clienteId TEXT NOT NULL REFERENCES Cliente(id) ON DELETE CASCADE,
  tipo      TEXT NOT NULL,  -- 'logo' | 'referencia'
  url       TEXT NOT NULL,
  nome      TEXT,
  createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_asset_cliente ON ClienteAsset(clienteId, tipo);

-- v8: banco de imagens auto-alimentado (origem da referência + contador de usos)
ALTER TABLE ClienteAsset ADD COLUMN origem TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE ClienteAsset ADD COLUMN usos INTEGER NOT NULL DEFAULT 0;
