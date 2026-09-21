import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ExternalLink, Image, LayoutTemplate, Loader2, Megaphone, Palette, RotateCcw, Save, Type } from "lucide-react";
import { PromocoesCardapioPanel } from "./PromocoesCardapioPanel";
import {
  BackendPizzaria,
  pizzariasApi,
  TemaBordas,
  TemaCardapioConfig,
  TemaCardapioModelo,
  TemaEstiloBotao,
  TemaEstiloCartoes,
  TemaFonteTexto,
  TemaFonteTitulo,
} from "../../lib/api";
import {
  TEMAS, FONTES_TITULO, FONTES_TEXTO, BORDAS, COPY_PADRAO, resolverTema, type TokensTema,
} from "../../lib/cardapioTema";

interface Props {
  pizzaria: BackendPizzaria;
  onUpdated: (pizzaria: BackendPizzaria) => void;
}

/*
  Presets, fontes e textos padrao vem de lib/cardapioTema.ts — a MESMA fonte que
  a pagina publica usa. Antes essa tela mantinha copias proprias, entao o preview
  do painel e o cardapio no ar podiam mostrar paletas diferentes.
*/
interface Preset {
  id: TemaCardapioModelo;
  nome: string;
  descricao: string;
  config: TokensTema & { modelo: TemaCardapioModelo };
}

export const TEMA_PRESETS: Preset[] = (Object.keys(TEMAS) as TemaCardapioModelo[]).map((id) => ({
  id,
  nome: TEMAS[id].label,
  descricao: TEMAS[id].descricao,
  config: { ...TEMAS[id].tokens, modelo: id },
}));

export function normalizarTema(tema?: TemaCardapioConfig | null): TemaCardapioConfig {
  return resolverTema(tema) as TemaCardapioConfig;
}

const TITLE_FONTS = (Object.keys(FONTES_TITULO) as Array<keyof typeof FONTES_TITULO>).map((value) => ({
  value: value as TemaFonteTitulo,
  label: FONTES_TITULO[value].label,
  css: FONTES_TITULO[value].stack,
}));

const BODY_FONTS = (Object.keys(FONTES_TEXTO) as Array<keyof typeof FONTES_TEXTO>).map((value) => ({
  value: value as TemaFonteTexto,
  label: FONTES_TEXTO[value].label,
  css: FONTES_TEXTO[value].stack,
}));

/* Tamanhos da previa: o artboard de referencia e 1440x6400 no desktop e 390 no
   celular; aqui basta uma janela alta o bastante pra mostrar hero + cardapio. */
const LARGURA_PREVIA = { desktop: 1280, mobile: 390 } as const;
const ALTURA_PREVIA = { desktop: 900, mobile: 780 } as const;

const RADII: Record<TemaBordas, string> = {
  retas: BORDAS.retas.raio,
  suaves: BORDAS.suaves.raio,
  arredondadas: BORDAS.arredondadas.raio,
};

export function TemasView({ pizzaria, onUpdated }: Props) {
  const [config, setConfig] = useState<TemaCardapioConfig>(() => normalizarTema(pizzaria.tema_cardapio));
  const [bannerUrl, setBannerUrl] = useState(pizzaria.banner_url || "");
  const [area, setArea] = useState<"identidade" | "promocoes">("identidade");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = TEMA_PRESETS.find((p) => p.id === config.modelo) || TEMA_PRESETS[0];

  const changed = useMemo(
    () => JSON.stringify(normalizarTema(pizzaria.tema_cardapio)) !== JSON.stringify(config) || (pizzaria.banner_url || "") !== bannerUrl.trim(),
    [pizzaria.tema_cardapio, pizzaria.banner_url, config, bannerUrl],
  );

  function update<K extends keyof TemaCardapioConfig>(key: K, value: TemaCardapioConfig[K]) {
    setConfig((current) => ({ ...current, [key]: value }));
    setSaved(false);
  }

  const [dispositivo, setDispositivo] = useState<"desktop" | "mobile">("desktop");
  const caixaPreviaRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [escala, setEscala] = useState(0.3);

  /* A previa encolhe pra caber na coluna: mede a caixa e escala o iframe. */
  useEffect(() => {
    const caixa = caixaPreviaRef.current;
    if (!caixa) return;
    const medir = () => setEscala(caixa.clientWidth / LARGURA_PREVIA[dispositivo]);
    medir();
    const observador = new ResizeObserver(medir);
    observador.observe(caixa);
    return () => observador.disconnect();
  }, [dispositivo]);

  /** Manda pro iframe o tema (e o banner) ainda nao salvos. */
  const enviarPrevia = useCallback(() => {
    const janela = iframeRef.current?.contentWindow;
    if (!janela) return;
    janela.postMessage(
      { tipo: "cdp-previa-tema", tema: config, banner: bannerUrl.trim() || null },
      window.location.origin,
    );
  }, [config, bannerUrl]);

  // Repinta a previa a cada tecla digitada / cor escolhida.
  useEffect(() => { enviarPrevia(); }, [enviarPrevia]);

  // O iframe pode ficar pronto antes deste componente: ele avisa, a gente responde.
  useEffect(() => {
    function aoAvisar(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      if ((e.data as { tipo?: string } | null)?.tipo === "cdp-previa-pronta") enviarPrevia();
    }
    window.addEventListener("message", aoAvisar);
    return () => window.removeEventListener("message", aoAvisar);
  }, [enviarPrevia]);

  function choosePreset(preset: Preset) {
    setConfig((current) => ({
      ...current,
      ...preset.config,
      chamada: current.chamada || COPY_PADRAO.chamada,
      titulo: current.titulo || COPY_PADRAO.titulo,
      descricao: current.descricao || COPY_PADRAO.descricao,
    }));
    setSaved(false);
  }

  function resetPreset() {
    setConfig((current) => ({ ...current, ...selected.config }));
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      // Busca a versão mais recente para não apagar campanhas/cupons salvos em
      // "Meu cardápio" caso esta tela ainda esteja com uma prop anterior.
      const latest = await pizzariasApi.get(pizzaria.id);
      const latestTheme = latest.tema_cardapio || {};
      const merged: TemaCardapioConfig = {
        ...config,
        campanhas: latestTheme.campanhas ?? config.campanhas,
        cupons: latestTheme.cupons ?? config.cupons,
        mostrar_acompanhamento: latestTheme.mostrar_acompanhamento ?? config.mostrar_acompanhamento,
      };
      const updated = await pizzariasApi.update(pizzaria.id, { tema_cardapio: merged, banner_url: bannerUrl.trim() || null });
      setConfig(merged);
      onUpdated(updated);
      setSaved(true);
    } catch (e: any) {
      setError(e.message || "Não foi possível salvar o tema.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-4 md:p-6 pb-24 md:pb-8 max-w-[1500px] mx-auto space-y-5">
      <nav className="inline-flex w-full sm:w-auto gap-1 rounded-xl border border-[#1e293b] bg-[#111622] p-1" aria-label="Seções de temas">
        <button type="button" onClick={() => setArea("identidade")} className={`flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition ${area === "identidade" ? "bg-orange-500 text-white shadow-sm" : "text-slate-400 hover:text-white hover:bg-[#161f30]"}`}><LayoutTemplate className="w-4 h-4" /> Identidade visual</button>
        <button type="button" onClick={() => setArea("promocoes")} className={`flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition ${area === "promocoes" ? "bg-orange-500 text-white shadow-sm" : "text-slate-400 hover:text-white hover:bg-[#161f30]"}`}><Megaphone className="w-4 h-4" /> Banners e cupons</button>
      </nav>

      {area === "identidade" ? <>
      <section className="rounded-2xl border border-[#1e293b] bg-[#111622] p-5 md:p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <div className="flex items-center gap-2 text-orange-400 mb-1">
              <Palette className="w-4 h-4" />
              <span className="text-xs font-bold uppercase tracking-wider">Identidade do cardápio</span>
            </div>
            <h1 className="text-xl font-bold text-white tracking-tight">Escolha uma direção visual</h1>
            <p className="text-xs text-slate-400 mt-1">Cada pizzaria pode ter sua própria combinação de estilo, tipografia e cores.</p>
          </div>
          {pizzaria.slug && (
            <a href={`/m/${pizzaria.slug}`} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#1e293b] bg-[#161f30] text-xs font-semibold text-slate-300 hover:text-white hover:bg-[#1e293b] transition">
              Ver cardápio <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>

        <div className="grid md:grid-cols-3 gap-3">
          {TEMA_PRESETS.map((preset) => {
            const active = config.modelo === preset.id;
            return (
              <button key={preset.id} type="button" aria-pressed={active} onClick={() => choosePreset(preset)}
                className={`relative overflow-hidden rounded-2xl border p-3.5 text-left transition-all ${active ? "border-orange-500 ring-1 ring-orange-500/30 bg-[#161f30]" : "border-[#1e293b] bg-[#161f30]/60 hover:border-slate-600"}`}>
                <div className="h-24 rounded-xl mb-3 overflow-hidden relative"
                  style={{ background: preset.config.cor_fundo, color: preset.id === "trattoria" ? "#2c1d17" : "#fff" }}>
                  <div className="h-3" style={{ background: preset.config.cor_primaria }} />
                  <div className="p-3 flex gap-2">
                    <div className="flex-1">
                      <div className="w-12 h-1.5 rounded-full opacity-40 bg-current mb-2" />
                      <div className="w-24 h-3 rounded-sm bg-current" />
                      <div className="w-16 h-3 rounded-sm mt-1" style={{ background: preset.config.cor_primaria }} />
                    </div>
                    <div className="w-20 rounded-lg opacity-80" style={{ background: `linear-gradient(135deg, ${preset.config.cor_primaria}, ${preset.config.cor_secundaria})` }} />
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <span className="flex-1">
                    <strong className="block text-sm font-bold text-white">{preset.nome}</strong>
                    <span className="block text-xs text-slate-400 mt-0.5">{preset.descricao}</span>
                  </span>
                  {active && <span className="w-6 h-6 rounded-full bg-orange-500 text-white grid place-items-center shrink-0 shadow-sm"><Check className="w-3.5 h-3.5" /></span>}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <div className="grid xl:grid-cols-[minmax(0,1fr)_minmax(420px,.9fr)] gap-5 items-start">
        <div className="space-y-5">
          <section className="rounded-2xl border border-[#1e293b] bg-[#111622] p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-2"><Type className="w-4 h-4 text-orange-400" /><h3 className="font-bold text-sm text-white">Tipografia e acabamento</h3></div>
              <button type="button" onClick={resetPreset} className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-orange-400 transition">
                <RotateCcw className="w-3.5 h-3.5" /> Restaurar estilo
              </button>
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <SelectField label="Fonte dos títulos" value={config.fonte_titulo || "anton"} onChange={(v) => update("fonte_titulo", v as TemaFonteTitulo)} options={TITLE_FONTS} />
              <SelectField label="Fonte dos textos" value={config.fonte_texto || "inter"} onChange={(v) => update("fonte_texto", v as TemaFonteTexto)} options={BODY_FONTS} />
              <SelectField label="Formato dos cantos" value={config.bordas || "suaves"} onChange={(v) => update("bordas", v as TemaBordas)} options={[
                { value: "retas", label: "Retos — editorial" }, { value: "suaves", label: "Suaves — equilibrado" }, { value: "arredondadas", label: "Arredondados — amigável" },
              ]} />
              <SelectField label="Estilo dos cartões" value={config.estilo_cartoes || "elevado"} onChange={(v) => update("estilo_cartoes", v as TemaEstiloCartoes)} options={[
                { value: "elevado", label: "Elevado — com profundidade" }, { value: "minimal", label: "Minimalista — discreto" }, { value: "contornado", label: "Contornado — marcante" },
              ]} />
              <SelectField label="Estilo dos botões" value={config.estilo_botao || "gradiente"} onChange={(v) => update("estilo_botao", v as TemaEstiloBotao)} options={[
                { value: "gradiente", label: "Gradiente — mais vibrante" }, { value: "solido", label: "Sólido — cor única" },
              ]} />
            </div>
          </section>

          <section className="rounded-2xl border border-[#1e293b] bg-[#111622] p-5 shadow-sm">
            <h3 className="font-bold text-sm text-white mb-4">Paleta da marca</h3>
            <div className="grid sm:grid-cols-3 gap-3">
              <ColorField label="Cor principal" value={config.cor_primaria || selected.config.cor_primaria} onChange={(v) => update("cor_primaria", v)} />
              <ColorField label="Cor secundária" value={config.cor_secundaria || selected.config.cor_secundaria} onChange={(v) => update("cor_secundaria", v)} />
              <ColorField label="Cor de fundo" value={config.cor_fundo || selected.config.cor_fundo} onChange={(v) => update("cor_fundo", v)} />
            </div>
          </section>
          <section className="rounded-2xl border border-[#1e293b] bg-[#111622] p-5 shadow-sm">
            <h3 className="font-bold text-sm text-white mb-1">Cores avançadas</h3>
            <p className="text-xs text-slate-400 mb-4">Ajuste a superfície dos cartões, leitura dos textos e os botões de ação.</p>
            <div className="grid sm:grid-cols-2 gap-3">
              <ColorField label="Superfície dos cartões" value={config.cor_superficie || selected.config.cor_superficie} onChange={(v) => update("cor_superficie", v)} />
              <ColorField label="Cor principal do texto" value={config.cor_texto || selected.config.cor_texto} onChange={(v) => update("cor_texto", v)} />
              <ColorField label="Fundo dos botões" value={config.cor_botao || config.cor_primaria || selected.config.cor_primaria} onChange={(v) => update("cor_botao", v)} />
              <ColorField label="Texto dos botões" value={config.cor_botao_texto || selected.config.cor_botao_texto} onChange={(v) => update("cor_botao_texto", v)} />
              <ColorField label="Texto secundário" value={config.cor_texto_suave || selected.config.cor_texto_suave} onChange={(v) => update("cor_texto_suave", v)} />
              <ColorField label="Texto de apoio" value={config.cor_texto_apagado || selected.config.cor_texto_apagado} onChange={(v) => update("cor_texto_apagado", v)} />
              <ColorField label="Linhas e bordas" value={config.cor_borda || selected.config.cor_borda} onChange={(v) => update("cor_borda", v)} />
              <ColorField label="Superfície elevada" value={config.cor_superficie_alta || selected.config.cor_superficie_alta} onChange={(v) => update("cor_superficie_alta", v)} />
            </div>
          </section>

          <section className="rounded-2xl border border-[#1e293b] bg-[#111622] p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-1"><Image className="w-4 h-4 text-orange-400" /><h3 className="font-bold text-sm text-white">Imagem do banner principal</h3></div>
            <p className="text-xs text-slate-400 mb-4">Use uma imagem horizontal com o produto mais à direita. O texto do cardápio ficará protegido e alinhado à esquerda.</p>
            <label className="block">
              <span className="block text-xs font-semibold text-slate-400 mb-1.5">Link da imagem do banner</span>
              <input type="url" value={bannerUrl} onChange={(event) => { setBannerUrl(event.target.value); setSaved(false); }} placeholder="https://exemplo.com/banner.jpg"
                className="w-full px-3.5 py-2 rounded-xl border border-[#1e293b] bg-[#161f30] text-xs text-white placeholder-slate-500 outline-none focus:border-orange-500" />
            </label>
            <div className="mt-3 overflow-hidden rounded-xl border border-[#1e293b] bg-[#161f30]">
              {bannerUrl.trim() ? <img src={bannerUrl.trim()} alt="Prévia do banner" className="h-40 w-full object-cover object-right" /> : <div className="h-40 grid place-items-center text-xs text-slate-500">Cole o link de uma imagem para ver a prévia.</div>}
            </div>
            <p className="mt-2 text-[11px] text-slate-500">Recomendado: 1920 × 720 px. Formatos JPG, PNG ou WebP hospedados em um link público.</p>
          </section>
          <section className="rounded-2xl border border-[#1e293b] bg-[#111622] p-5 shadow-sm">
            <h3 className="font-bold text-sm text-white mb-4">Textos de apresentação</h3>
            <div className="space-y-3">
              <TextField label="Chamada pequena" value={config.chamada || ""} onChange={(v) => update("chamada", v)} maxLength={70} />
              <TextField label="Título principal" help="Use | para definir a quebra e destacar a segunda parte." value={config.titulo || ""} onChange={(v) => update("titulo", v)} maxLength={70} />
              <label className="block">
                <span className="block text-xs font-semibold text-slate-400 mb-1.5">Descrição</span>
                <textarea rows={3} value={config.descricao || ""} maxLength={180} onChange={(e) => update("descricao", e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl border border-[#1e293b] bg-[#161f30] text-xs text-white placeholder-slate-500 outline-none focus:border-orange-500" />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <TextField label="Botão principal" value={config.cta_primario || ""} onChange={(v) => update("cta_primario", v)} maxLength={28} />
                <TextField label="Botão secundário" value={config.cta_secundario || ""} onChange={(v) => update("cta_secundario", v)} maxLength={28} />
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-[#1e293b] bg-[#111622] p-5 shadow-sm">
            <h3 className="font-bold text-sm text-white mb-1">Barra de cupom</h3>
            <p className="text-[11px] text-slate-500 mb-4">Aparece no topo do site quando existe um cupom ativo.</p>
            <label className="flex items-center gap-2 mb-3 cursor-pointer">
              <input type="checkbox" checked={config.barra_cupom_ativa !== false} onChange={(e) => update("barra_cupom_ativa", e.target.checked)} className="accent-orange-500" />
              <span className="text-xs font-semibold text-slate-300">Mostrar a barra de cupom</span>
            </label>
            <TextField label="Texto da barra" value={config.barra_cupom_texto || ""} onChange={(v) => update("barra_cupom_texto", v)} maxLength={90} />
          </section>

          <ListaEditavel
            titulo="Diferenciais"
            ajuda="Os quatro blocos logo abaixo da capa."
            itens={config.diferenciais || []}
            onChange={(itens) => update("diferenciais", itens)}
            campos={[
              { chave: "titulo", label: "Título", max: 34 },
              { chave: "descricao", label: "Descrição", max: 48 },
            ]}
            novoItem={{ icone: "relogio", titulo: "", descricao: "" }}
            max={4}
          />

          <section className="rounded-2xl border border-[#1e293b] bg-[#111622] p-5 shadow-sm">
            <h3 className="font-bold text-sm text-white mb-4">Títulos das seções</h3>
            <div className="space-y-3">
              <TextField label="Promoções" value={config.promocoes_titulo || ""} onChange={(v) => update("promocoes_titulo", v)} maxLength={60} />
              <TextField label="Subtítulo das promoções" value={config.promocoes_subtitulo || ""} onChange={(v) => update("promocoes_subtitulo", v)} maxLength={90} />
              <TextField label="Passos do pedido" value={config.passos_titulo || ""} onChange={(v) => update("passos_titulo", v)} maxLength={60} />
              <TextField label="Dúvidas" value={config.faq_titulo || ""} onChange={(v) => update("faq_titulo", v)} maxLength={60} />
              <TextField label="Frase do rodapé" value={config.rodape_frase || ""} onChange={(v) => update("rodape_frase", v)} maxLength={80} />
            </div>
          </section>

          <ListaEditavel
            titulo="Passos do pedido"
            ajuda="Como você explica o processo para quem nunca pediu."
            itens={config.passos || []}
            onChange={(itens) => update("passos", itens)}
            campos={[
              { chave: "titulo", label: "Título", max: 30 },
              { chave: "descricao", label: "Descrição", max: 90 },
            ]}
            novoItem={{ titulo: "", descricao: "" }}
            max={3}
          />

          <ListaEditavel
            titulo="Dúvidas frequentes"
            ajuda="Responder aqui reduz mensagem repetida no WhatsApp."
            itens={config.faq || []}
            onChange={(itens) => update("faq", itens)}
            campos={[
              { chave: "pergunta", label: "Pergunta", max: 90 },
              { chave: "resposta", label: "Resposta", max: 220 },
            ]}
            novoItem={{ pergunta: "", resposta: "" }}
            max={8}
          />
        </div>

        <aside className="xl:sticky xl:top-24 rounded-2xl border border-[#1e293b] bg-[#111622] p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3 px-1 gap-2">
            <strong className="text-sm font-bold text-white">Prévia da identidade</strong>
            <div className="flex items-center gap-1 rounded-lg border border-[#1e293b] bg-[#161f30] p-0.5">
              {([["desktop", "Computador"], ["mobile", "Celular"]] as const).map(([id, rotulo]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setDispositivo(id)}
                  className={`px-2 py-1 rounded-md text-[10px] font-semibold transition-colors ${
                    dispositivo === id ? "bg-orange-500 text-white" : "text-slate-400 hover:text-white"
                  }`}
                >
                  {rotulo}
                </button>
              ))}
            </div>
          </div>

          {/* A previa e o cardapio de verdade num iframe, recebendo o tema ainda
              nao salvo por postMessage. Um mockup paralelo divergiria da pagina
              real a cada mudanca de layout. */}
          <div
            ref={caixaPreviaRef}
            className="relative overflow-hidden rounded-xl border border-white/10 bg-[#0b0f18]"
            style={{ height: Math.round(ALTURA_PREVIA[dispositivo] * escala) }}
          >
            {pizzaria.slug ? (
              <iframe
                ref={iframeRef}
                title="Prévia do cardápio"
                src={`/m/${pizzaria.slug}`}
                onLoad={enviarPrevia}
                className="absolute top-0 left-0 origin-top-left border-0"
                style={{
                  width: LARGURA_PREVIA[dispositivo],
                  height: ALTURA_PREVIA[dispositivo],
                  transform: `scale(${escala})`,
                }}
              />
            ) : (
              <div className="h-full grid place-items-center p-6 text-center text-[11px] text-slate-400">
                Defina o endereço (slug) do cardápio para ver a prévia.
              </div>
            )}
          </div>

          <p className="mt-2 text-[11px] text-slate-500">
            É o cardápio real, com as mudanças que você ainda não salvou. Role dentro
            da prévia para ver as outras seções.
          </p>
        </aside>
      </div>

      {error && <div className="rounded-xl border border-red-500/30 bg-red-950/40 text-red-300 px-4 py-3 text-xs">{error}</div>}
      <div className="sticky bottom-3 flex justify-end pointer-events-none">
        <button type="button" onClick={save} disabled={saving || !changed}
          className="pointer-events-auto inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold shadow-sm disabled:opacity-50 transition">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
          {saving ? "Salvando..." : saved ? "Tema salvo" : "Salvar tema"}
        </button>
      </div>
      </> : <PromocoesCardapioPanel pizzariaId={pizzaria.id} onUpdated={onUpdated} />}
    </div>
  );
}

function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }> }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-slate-400 mb-1.5">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full px-3 py-2.5 rounded-xl border border-[#1e293b] bg-[#161f30] text-xs text-white outline-none focus:border-orange-500">
        {options.map((o) => <option key={o.value} value={o.value} className="bg-[#111622]">{o.label}</option>)}
      </select>
    </label>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-slate-400 mb-1.5">{label}</span>
      <span className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl border border-[#1e293b] bg-[#161f30]">
        <input type="color" value={value} onChange={(e) => { setDraft(e.target.value); onChange(e.target.value); }} className="w-8 h-8 rounded-lg border-0 bg-transparent p-0 cursor-pointer" />
        <input value={draft} onChange={(e) => { const next = e.target.value; if (/^#[0-9a-fA-F]{0,6}$/.test(next)) { setDraft(next); if (/^#[0-9a-fA-F]{6}$/.test(next)) onChange(next); } }} onBlur={() => setDraft(value)} className="min-w-0 flex-1 bg-transparent border-0 text-xs font-mono text-white uppercase outline-none" />
      </span>
    </label>
  );
}

function TextField({ label, help, value, onChange, maxLength }: { label: string; help?: string; value: string; onChange: (value: string) => void; maxLength: number }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-slate-400 mb-1.5">{label}</span>
      <input value={value} maxLength={maxLength} onChange={(e) => onChange(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-[#1e293b] bg-[#161f30] text-xs text-white placeholder-slate-500 outline-none focus:border-orange-500" />
      {help && <small className="block text-[10px] text-slate-500 mt-1">{help}</small>}
    </label>
  );
}

/**
 * Lista de blocos repetidos (diferenciais, passos, duvidas).
 *
 * Lista vazia = o cardapio usa o texto padrao. Por isso remover tudo e uma acao
 * segura: a secao nao fica em branco no ar, ela volta ao padrao.
 */
function ListaEditavel<T extends Record<string, string | undefined>>({
  titulo, ajuda, itens, onChange, campos, novoItem, max,
}: {
  titulo: string;
  ajuda?: string;
  itens: T[];
  onChange: (itens: T[]) => void;
  campos: Array<{ chave: keyof T & string; label: string; max: number }>;
  novoItem: T;
  max: number;
}) {
  const alterar = (indice: number, chave: string, valor: string) => {
    onChange(itens.map((item, i) => (i === indice ? { ...item, [chave]: valor } : item)));
  };

  return (
    <section className="rounded-2xl border border-[#1e293b] bg-[#111622] p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="font-bold text-sm text-white">{titulo}</h3>
          {ajuda && <p className="text-[11px] text-slate-500 mt-0.5">{ajuda}</p>}
        </div>
        {itens.length < max && (
          <button
            type="button"
            onClick={() => onChange([...itens, { ...novoItem }])}
            className="shrink-0 px-3 py-1.5 rounded-lg border border-[#1e293b] bg-[#161f30] text-[11px] font-semibold text-slate-300 hover:border-orange-500 hover:text-white"
          >
            + Adicionar
          </button>
        )}
      </div>

      <div className="space-y-3">
        {itens.map((item, indice) => (
          <div key={indice} className="rounded-xl border border-[#1e293b] bg-[#161f30] p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                {indice + 1}
              </span>
              <button
                type="button"
                onClick={() => onChange(itens.filter((_, i) => i !== indice))}
                className="text-[11px] font-semibold text-slate-500 hover:text-red-400"
              >
                Remover
              </button>
            </div>
            <div className="space-y-2">
              {campos.map((campo) => (
                <label className="block" key={campo.chave}>
                  <span className="block text-[11px] font-semibold text-slate-400 mb-1">{campo.label}</span>
                  <input
                    value={(item[campo.chave] as string) || ""}
                    maxLength={campo.max}
                    onChange={(e) => alterar(indice, campo.chave, e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg border border-[#1e293b] bg-[#0f1624] text-xs text-white placeholder-slate-500 outline-none focus:border-orange-500"
                  />
                </label>
              ))}
            </div>
          </div>
        ))}

        {itens.length === 0 && (
          <p className="text-[11px] text-slate-500 py-2">
            Sem itens próprios — o cardápio mostra o texto padrão.
          </p>
        )}
      </div>
    </section>
  );
}
