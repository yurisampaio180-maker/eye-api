export interface DNAInput {
  nome: string;
  posicionamento: string;
  tomDeVoz: string;
  paleta: { nome: string; hex: string }[];
  tipografia: { display: string; corpo: string };
  referencias: string[];
  proibicoes: string[];
}

export interface ItemPlanoArte {
  titulo: string;
  objetivo: string;
  descricaoBrief: string;
  copyHook: string;
  formato: string;
}

export function montarPromptProfissional(params: {
  item: ItemPlanoArte;
  dna: DNAInput;
}): { promptFinal: string } {
  const { item, dna } = params;
  const layers = [
    buildAncora(item.formato),
    buildIdentidade(dna),
    buildCena(item, dna),
    buildIluminacao(dna, item.objetivo),
    buildTipografia(item, dna),
    buildAtmosfera(dna, item.objetivo),
    buildReferencias(dna, item.objetivo),
    buildMood(item.objetivo, dna),
    buildDoNots(dna),
  ].filter(Boolean);
  return { promptFinal: layers.join('\n\n') };
}

// ─── Camada 1: Âncora de qualidade ──────────────────────────────────────────

function buildAncora(formato: string): string {
  const specs: Record<string, string> = {
    feed: '1080x1080px, 1:1 ratio, Instagram feed post',
    stories: '1080x1920px, 9:16 ratio, Instagram Stories',
    carrossel: '1080x1080px, 1:1 ratio, Instagram carousel slide',
    reels: '1080x1920px, 9:16 ratio, Instagram Reels cover',
  };
  return `TECHNICAL SPECS: ${specs[formato] ?? specs.feed}.
Art direction: International marketing agency, award-winning creative direction.
Production quality: Comparable to Ogilvy, Wieden+Kennedy, VMLY&R campaigns.
Visual standard: Cannes Lions caliber. Every pixel intentional.
Photography quality: Getty editorial level or higher. NOT stock. NOT template. NOT amateur.`;
}

// ─── Camada 2: Identidade da marca ──────────────────────────────────────────

function buildIdentidade(dna: DNAInput): string {
  const paleta = dna.paleta.map((c) => `${c.nome}: ${c.hex}`).join(', ') || 'brand palette';
  return `BRAND IDENTITY — ${dna.nome.toUpperCase()}:
Primary palette: ${paleta}.
Typography: ${dna.tipografia.display || 'bold display font'} (headlines, impactful) + ${dna.tipografia.corpo || 'clean body font'} (supporting text).
Brand voice: ${dna.tomDeVoz || 'premium, trustworthy'}.
Positioning: ${dna.posicionamento || 'market leader'}.
Brand color present but elegantly integrated — never oversaturated or garish.`;
}

// ─── Camada 3: Cena e composição (DNA-aware) ────────────────────────────────

function buildCena(item: ItemPlanoArte, dna: DNAInput): string {
  const n = dna.nome.toLowerCase();

  if (n.includes('nutri') || n.includes('leve')) {
    return item.objetivo === 'vender'
      ? `SCENE: Premium supplement hero shot on deep forest-green (#1B4332) matte surface.
Product center-frame, dramatic golden rim light. Athlete hand entering frame holding product.
Gym environment blurred in background (f/1.4 bokeh). Gold and green color story throughout.
${item.descricaoBrief}`
      : `SCENE: Real CNBox CrossFit athlete, natural movement, not posed.
Golden hour streaming through gym windows. Green and gold color tones.
${item.descricaoBrief}`;
  }

  if (n.includes('junior') || n.includes('univel')) {
    return `SCENE: Car hero shot, 3/4 front-left angle, low camera position for drama.
${item.objetivo === 'vender' ? 'Studio quality lighting or open-road golden hour.' : 'Real dealership moment, authentic customer interaction.'}
Deep black (#0A0A0A) and bold red (#CC0000) color story. Car occupies 70% of frame, sharp focus.
${item.descricaoBrief}`;
  }

  if (n.includes('verso') || (n.includes('nosso') && !n.includes('governo'))) {
    return `SCENE: Intimate human moment. Warm amber cinematic light (2800K). A24 film aesthetic.
Real person, not a model. Emotion: ${item.objetivo === 'vender' ? 'joy of giving a deeply meaningful gift' : 'genuine human connection and warmth'}.
Never commercial-looking. Authentic, poetic, cinematic.
${item.descricaoBrief}`;
  }

  if (n.includes('governo') || n.includes('moraujo') || n.includes('prefeitura') || n.includes('morau')) {
    return `SCENE: Community transformation visible. Real people of Moraújo, genuine emotion.
${item.objetivo === 'institucional' ? 'Public infrastructure improvement, hopeful community.' : 'Local service delivery, citizens benefiting directly.'}
Warm, optimistic, humanized. "Um Novo Tempo" energy. Not political — human.
${item.descricaoBrief}`;
  }

  if (n.includes('eye') || n.includes('agência') || n.includes('agencia')) {
    return `SCENE: Agency excellence and real results. Dark environment (#0A0A0A) with red (#E11D2A) accents.
HUD/tech overlay elements subtle. ${item.objetivo === 'institucional' ? 'Team at work, authentic creative process.' : 'Client results in bold typography, data as design element.'}
Editorial tech aesthetic. Authoritative, performance-driven.
${item.descricaoBrief}`;
  }

  const defaults: Record<string, string> = {
    vender: `SCENE: Product or service hero. Subject center-frame. Rule of thirds composition.
Strong focal point. Intentional negative space for text. Desire-inducing depth.
${item.descricaoBrief}`,
    engajar: `SCENE: Authentic human moment. Candid aesthetic. Real person, slightly off-camera gaze.
Community or personal context. Nothing posed or stock-feeling.
${item.descricaoBrief}`,
    educar: `SCENE: Clean information architecture. Data and steps as visual elements.
Icons and typography as primary visual language. Organized and readable.
${item.descricaoBrief}`,
    institucional: `SCENE: Brand presence humanized. Warm, trustworthy, community-connected.
People in natural interaction. Location-authentic, not staged.
${item.descricaoBrief}`,
    entreter: `SCENE: Dynamic composition. Movement or bold contrast implied.
Visual surprise or bold metaphor. Stop-scroll energy.
${item.descricaoBrief}`,
  };
  return defaults[item.objetivo] ?? defaults.engajar;
}

// ─── Camada 4: Iluminação cinematográfica ────────────────────────────────────

function buildIluminacao(dna: DNAInput, objetivo: string): string {
  const n = dna.nome.toLowerCase();

  if (n.includes('nutri') || n.includes('leve')) {
    return `LIGHTING: Three-point studio setup. Amber key light (3200K) upper-left 45°.
Rim light from right for product edge separation. Soft fill eliminates harsh shadows.
Optional: subtle intentional lens flare. Result: magazine-quality supplement advertising.`;
  }
  if (n.includes('junior') || n.includes('univel')) {
    return `LIGHTING: Dramatic automotive. Strong key upper-right, deep volume shadows left.
Cool rim light (5500K) tracing car body. Ground reflection subtle.
Optional: atmosphere haze particles. Result: official automotive brand campaign quality.`;
  }
  if (n.includes('verso') || n.includes('nosso')) {
    return `LIGHTING: Warm cinematic amber (2800K) key from upper-left. Background bokeh.
Intimate and emotional. A24 film quality. Shadows: soft, never harsh.
Skin tones warm and natural. Lens flare: subtle, poetic.`;
  }
  if (n.includes('governo') || n.includes('moraujo') || n.includes('prefeitura')) {
    return `LIGHTING: Natural golden hour or optimistic bright midday. Warm, accessible, welcoming.
No dramatic shadows — humanized and community-friendly. Clear, bright, trustworthy.`;
  }
  if (n.includes('eye') || n.includes('agência') || n.includes('agencia')) {
    return `LIGHTING: High-contrast editorial. Strong directional key light.
Red (#E11D2A) as practical light source or accent element. Deep, rich blacks.
Cinematic color grade: desaturated background, saturated focal subject.`;
  }

  return `LIGHTING: Cinematic quality. Defined key light source with intentional shadow work.
${objetivo === 'vender' ? 'Product-flattering — every angle maximizes visual appeal.' : ''}
${objetivo === 'engajar' ? 'Warm, accessible light that creates emotional connection.' : ''}
${objetivo === 'educar' ? 'Neutral, clear light — nothing distracts from information.' : ''}
Three-point or Rembrandt lighting system. Volumetric where appropriate. Never flat.`.trim();
}

// ─── Camada 5: Tipografia hierárquica ───────────────────────────────────────

function buildTipografia(item: ItemPlanoArte, dna: DNAInput): string {
  const display = dna.tipografia.display || 'bold display sans-serif';
  const corpo = dna.tipografia.corpo || 'clean readable sans-serif';
  const headline = (item.copyHook || item.titulo).toUpperCase();
  return `TYPOGRAPHY: Hierarchical and intentional — text as design element.
H1 HEADLINE: "${headline}" — ${display}, massive and dominant, 90-120pt equivalent.
Placed in intentional negative space. Optically sized. Letter-spacing considered.
Text contrast: minimum 4.5:1 WCAG AA. Text color: brand palette only.
Supporting body (if any): ${corpo}, max 2 lines, 16-24pt equivalent.
NO opaque text boxes. NO more than 5 text elements total. NO centered text unless compositionally required.`;
}

// ─── Camada 6: Atmosfera e textura ──────────────────────────────────────────

function buildAtmosfera(dna: DNAInput, objetivo: string): string {
  const n = dna.nome.toLowerCase();
  const parts: string[] = ['ATMOSPHERE & TEXTURE:'];

  if (n.includes('nutri') || n.includes('verso')) parts.push('Film grain overlay 3-4%.');
  if (n.includes('nutri')) parts.push('Gold dust particles or supplement burst effect optional.');
  if (n.includes('junior') || n.includes('univel')) parts.push('Subtle tire-track or speed-line motion element optional.');
  if (n.includes('eye') || n.includes('agência') || n.includes('agencia')) {
    parts.push('HUD/tech overlay in red (#E11D2A). Circuit or data-stream motifs subtle.');
  }
  if (objetivo === 'vender') parts.push('Premium texture on backgrounds. Desire-inducing material depth.');
  if (objetivo === 'engajar') parts.push('Warmth and authenticity. Organic, natural textures.');

  parts.push('Depth layers always defined: foreground / midground / background. Never compositionally flat.');
  parts.push('Color grade: intentional, consistent with brand palette. Decorative elements serve composition.');
  return parts.join('\n');
}

// ─── Camada 7: Referências visuais ──────────────────────────────────────────

function buildReferencias(dna: DNAInput, objetivo: string): string {
  const n = dna.nome.toLowerCase();
  const base = dna.referencias.length > 0
    ? dna.referencias.slice(0, 4).join(', ')
    : 'Nike athlete campaigns, Apple product photography';

  let extra = '';
  if (n.includes('nutri')) extra = ', Optimum Nutrition, C4 Energy, Myprotein premium';
  else if (n.includes('junior') || n.includes('univel')) extra = ', Honda/Toyota/VW official campaigns, BMW editorial';
  else if (n.includes('verso')) extra = ", A24 Films, Spotify Wrapped, Apple Mother's Day";
  else if (n.includes('governo') || n.includes('prefeitura')) extra = ', humanized documentary photography, World Press Photo community';

  return `VISUAL REFERENCES: ${base}${extra}.
Study these references for: composition ratios, lighting style, typography scale, color integration.
Match their QUALITY LEVEL — translate to this brand's unique identity. Not a copy — an inspiration.`;
}

// ─── Camada 8: Mood board verbal ────────────────────────────────────────────

function buildMood(objetivo: string, dna: DNAInput): string {
  const n = dna.nome.toLowerCase();
  const objetivoMoods: Record<string, string> = {
    vender: 'OBJECTIVE MOOD: Desire. Premium. Aspirational. "I need this in my life."',
    engajar: 'OBJECTIVE MOOD: Authentic. Relatable. Shareable. Stop-scroll energy. Emotion first.',
    educar: 'OBJECTIVE MOOD: Authoritative. Clear. Trustworthy. "This expert knows exactly what to do."',
    institucional: 'OBJECTIVE MOOD: Community pride. Real impact. Trust. Humanized authority.',
    entreter: 'OBJECTIVE MOOD: Surprising. Delightful. Share-worthy. Entertains AND builds brand.',
  };

  const clienteMoods: [string, string][] = [
    ['nutri', 'CLIENT MOOD: Performance discipline. Premium results. "Best supplements in Sobral."'],
    ['junior', 'CLIENT MOOD: Automotive authority. Power. Confidence. "Best deal in the region."'],
    ['verso', 'CLIENT MOOD: Poetic. Cinematic depth. "Any gift gives flowers. You give the song of her life."'],
    ['governo', 'CLIENT MOOD: Hope and transformation. Moraújo pride. "Um Novo Tempo made visible."'],
    ['eye', 'CLIENT MOOD: Agency excellence. Data-driven artistry. Results louder than vanity.'],
  ];

  const clienteMood = clienteMoods.find(([k]) => n.includes(k))?.[1]
    ?? `CLIENT MOOD: ${dna.posicionamento || 'premium, trusted brand'}`;

  const moodWords: Record<string, string[]> = {
    vender: ['desire', 'premium', 'aspire', 'invest', 'transform', 'now'],
    engajar: ['real', 'moment', 'feel', 'share', 'community', 'human'],
    educar: ['clarity', 'authority', 'grow', 'trust', 'expert', 'learn'],
    institucional: ['pride', 'impact', 'community', 'change', 'together', 'real'],
    entreter: ['bold', 'surprise', 'joy', 'energy', 'creative', 'viral'],
  };
  const words = (moodWords[objetivo] ?? moodWords.engajar).join(' · ');

  return `${objetivoMoods[objetivo] ?? objetivoMoods.engajar}
${clienteMood}
Verbal mood board: ${words}`;
}

// ─── Camada 9: DO NOTs ──────────────────────────────────────────────────────

function buildDoNots(dna: DNAInput): string {
  const universal = [
    'NO generic stock photography or model-stock imagery',
    'NO solid opaque box behind text',
    'NO more than 5 text elements in the composition',
    'NO clip art, emoji-as-design, or icon-heavy layout',
    'NO oversaturated or neon colors outside brand palette',
    'NO filters that distort brand colors or skin tones',
    'NO amateur composition — rule of thirds always respected',
    'NO flat design — depth and dimension always present',
  ];
  const clienteNots = dna.proibicoes.map((p) => `NO: ${p}`);
  return `DO NOTs — mandatory exclusions:
${[...universal, ...clienteNots].join('\n')}`;
}
