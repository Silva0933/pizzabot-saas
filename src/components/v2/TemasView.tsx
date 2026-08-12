import { useEffect, useMemo, useState } from "react";
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

interface Props {
  pizzaria: BackendPizzaria;
  onUpdated: (pizzaria: BackendPizzaria) => void;
}

interface Preset {
  id: TemaCardapioModelo;
  nome: string;
  descricao: string;
  detalhe: string;
  config: Required<Pick<TemaCardapioConfig,
    "modelo" | "fonte_titulo" | "fonte_texto" | "cor_primaria" | "cor_secundaria" | "cor_fundo" | "bordas"
  >>;
}

export const TEMA_PRESETS: Preset[] = [
  {
    id: "brasa",
    nome: "Brasa",
    descricao: "Escuro, intenso e gastronômico",
    detalhe: "Ideal para burgers, pizzas e cozinha artesanal.",
    config: {
      modelo: "brasa", fonte_titulo: "anton", fonte_texto: "inter",
      cor_primaria: "#f26b21", cor_secundaria: "#ff4d22", cor_fundo: "#090907", bordas: "suaves",
    },
  },
  {
    id: "trattoria",
    nome: "Trattoria",
    descricao: "Clássico, acolhedor e elegante",
    detalhe: "Perfeito para pizzarias tradicionais e marcas familiares.",
    config: {
      modelo: "trattoria", fonte_titulo: "playfair", fonte_texto: "nunito",
      cor_primaria: "#a52a2a", cor_secundaria: "#d39b45", cor_fundo: "#f5ecdf", bordas: "suaves",
    },
  },
  {
    id: "metropole",
    nome: "Metrópole",
    descricao: "Moderno, vibrante e tecnológico",
    detalhe: "Para operações jovens, delivery e marcas urbanas.",
    config: {
      modelo: "metropole", fonte_titulo: "outfit", fonte_texto: "montserrat",
      cor_primaria: "#b7f34a", cor_secundaria: "#7c5cff", cor_fundo: "#0b1020", bordas: "arredondadas",
    },
  },
];

const DEFAULT_TEXT = {
  chamada: "FEITO NA HORA. DO SEU JEITO.",
  titulo: "O SABOR QUE|ACENDE A FOME.",
  descricao: "Escolha seus favoritos, personalize o pedido e receba tudo quentinho onde estiver.",
};

export function normalizarTema(tema?: TemaCardapioConfig | null): TemaCardapioConfig {
  const preset = TEMA_PRESETS.find((p) => p.id === tema?.modelo) || TEMA_PRESETS[0];
  return { ...preset.config, ...DEFAULT_TEXT, ...(tema || {}) };
}

const TITLE_FONTS: Array<{ value: TemaFonteTitulo; label: string; css: string }> = [
  { value: "anton", label: "Anton — forte", css: '"Anton SC", Impact, sans-serif' },
  { value: "bebas", label: "Bebas — condensada", css: '"Bebas Neue", Impact, sans-serif' },
  { value: "playfair", label: "Playfair — elegante", css: '"Playfair Display", Georgia, serif' },
  { value: "outfit", label: "Outfit — moderna", css: '"Outfit", Inter, sans-serif' },
];

const BODY_FONTS: Array<{ value: TemaFonteTexto; label: string; css: string }> = [
  { value: "inter", label: "Inter — neutra", css: 'Inter, Arial, sans-serif' },
  { value: "montserrat", label: "Montserrat — geométrica", css: 'Montserrat, Arial, sans-serif' },
  { value: "nunito", label: "Nunito — amigável", css: 'Nunito, Arial, sans-serif' },
  { value: "outfit", label: "Outfit — contemporânea", css: 'Outfit, Arial, sans-serif' },
];

const RADII: Record<TemaBordas, string> = { retas: "4px", suaves: "14px", arredondadas: "28px" };

export function TemasView({ pizzaria, onUpdated }: Props) {
  const [config, setConfig] = useState<TemaCardapioConfig>(() => normalizarTema(pizzaria.tema_cardapio));
  const [bannerUrl, setBannerUrl] = useState(pizzaria.banner_url || "");
  const [area, setArea] = useState<"identidade" | "promocoes">("identidade");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = TEMA_PRESETS.find((p) => p.id === config.modelo) || TEMA_PRESETS[0];
  const titleFont = TITLE_FONTS.find((f) => f.value === config.fonte_titulo)?.css || TITLE_FONTS[0].css;
  const bodyFont = BODY_FONTS.find((f) => f.value === config.fonte_texto)?.css || BODY_FONTS[0].css;
  const tituloPartes = String(config.titulo || DEFAULT_TEXT.titulo).split("|");
  const isLight = config.modelo === "trattoria";
  const previewText = isLight ? "#2c1d17" : "#fff8ef";
  const previewMuted = isLight ? "#766055" : "#afa6a0";

  const changed = useMemo(
    () => JSON.stringify(normalizarTema(pizzaria.tema_cardapio)) !== JSON.stringify(config) || (pizzaria.banner_url || "") !== bannerUrl.trim(),
    [pizzaria.tema_cardapio, pizzaria.banner_url, config, bannerUrl],
  );

  function update<K extends keyof TemaCardapioConfig>(key: K, value: TemaCardapioConfig[K]) {
    setConfig((current) => ({ ...current, [key]: value }));
    setSaved(false);
  }

  function choosePreset(preset: Preset) {
    setConfig((current) => ({
      ...current,
      ...preset.config,
      chamada: current.chamada || DEFAULT_TEXT.chamada,
      titulo: current.titulo || DEFAULT_TEXT.titulo,
      descricao: current.descricao || DEFAULT_TEXT.descricao,
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
      <nav className="inline-flex w-full sm:w-auto gap-1 rounded-xl border border-line bg-surface p-1" aria-label="Seções de temas">
        <button type="button" onClick={() => setArea("identidade")} className={`flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition ${area === "identidade" ? "bg-brand-500 text-white" : "text-ink-muted hover:bg-surface-muted"}`}><LayoutTemplate className="w-4 h-4" /> Identidade visual</button>
        <button type="button" onClick={() => setArea("promocoes")} className={`flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition ${area === "promocoes" ? "bg-brand-500 text-white" : "text-ink-muted hover:bg-surface-muted"}`}><Megaphone className="w-4 h-4" /> Banners e cupons</button>
      </nav>

      {area === "identidade" ? <>
      <section className="rounded-2xl border border-line bg-surface p-4 md:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <div className="flex items-center gap-2 text-brand-500 mb-1">
              <Palette className="w-4 h-4" />
              <span className="text-xs font-bold uppercase tracking-[.16em]">Identidade do cardápio</span>
            </div>
            <h2 className="text-xl font-bold text-ink">Escolha uma direção visual</h2>
            <p className="text-sm text-ink-muted mt-1">Cada pizzaria pode ter sua própria combinação de estilo, tipografia e cores.</p>
          </div>
          {pizzaria.slug && (
            <a href={`/m/${pizzaria.slug}`} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-line bg-surface-muted text-xs font-semibold text-ink hover:border-brand-500">
              Ver cardápio <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>

        <div className="grid md:grid-cols-3 gap-3">
          {TEMA_PRESETS.map((preset) => {
            const active = config.modelo === preset.id;
            return (
              <button key={preset.id} type="button" aria-pressed={active} onClick={() => choosePreset(preset)}
                className={`relative overflow-hidden rounded-2xl border p-3 text-left transition-all ${active ? "border-brand-500 ring-2 ring-brand-500/20" : "border-line hover:border-slate-500"}`}>
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
                    <strong className="block text-sm text-ink">{preset.nome}</strong>
                    <span className="block text-xs text-ink-muted mt-0.5">{preset.descricao}</span>
                    <small className="block text-[10px] text-ink-subtle mt-1">{preset.detalhe}</small>
                  </span>
                  {active && <span className="w-6 h-6 rounded-full bg-brand-500 text-white grid place-items-center"><Check className="w-3.5 h-3.5" /></span>}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <div className="grid xl:grid-cols-[minmax(0,1fr)_minmax(420px,.9fr)] gap-5 items-start">
        <div className="space-y-5">
          <section className="rounded-2xl border border-line bg-surface p-4 md:p-5">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-2"><Type className="w-4 h-4 text-brand-500" /><h3 className="font-bold text-ink">Tipografia e acabamento</h3></div>
              <button type="button" onClick={resetPreset} className="inline-flex items-center gap-1 text-xs text-ink-muted hover:text-brand-500">
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

          <section className="rounded-2xl border border-line bg-surface p-4 md:p-5">
            <h3 className="font-bold text-ink mb-4">Paleta da marca</h3>
            <div className="grid sm:grid-cols-3 gap-3">
              <ColorField label="Cor principal" value={config.cor_primaria || selected.config.cor_primaria} onChange={(v) => update("cor_primaria", v)} />
              <ColorField label="Cor secundária" value={config.cor_secundaria || selected.config.cor_secundaria} onChange={(v) => update("cor_secundaria", v)} />
              <ColorField label="Cor de fundo" value={config.cor_fundo || selected.config.cor_fundo} onChange={(v) => update("cor_fundo", v)} />
            </div>
          </section>
          <section className="rounded-2xl border border-line bg-surface p-4 md:p-5">
            <h3 className="font-bold text-ink mb-1">Cores avançadas</h3>
            <p className="text-xs text-ink-muted mb-4">Ajuste a superfície dos cartões, leitura dos textos e os botões de ação.</p>
            <div className="grid sm:grid-cols-2 gap-3">
              <ColorField label="Superfície dos cartões" value={config.cor_superficie || "#15161f"} onChange={(v) => update("cor_superficie", v)} />
              <ColorField label="Cor principal do texto" value={config.cor_texto || (isLight ? "#2c1d17" : "#f3f4f9")} onChange={(v) => update("cor_texto", v)} />
              <ColorField label="Fundo dos botões" value={config.cor_botao || config.cor_primaria || selected.config.cor_primaria} onChange={(v) => update("cor_botao", v)} />
              <ColorField label="Texto dos botões" value={config.cor_botao_texto || "#ffffff"} onChange={(v) => update("cor_botao_texto", v)} />
            </div>
          </section>


          <section className="rounded-2xl border border-line bg-surface p-4 md:p-5">
            <div className="flex items-center gap-2 mb-1"><Image className="w-4 h-4 text-brand-500" /><h3 className="font-bold text-ink">Imagem do banner principal</h3></div>
            <p className="text-xs text-ink-muted mb-4">Use uma imagem horizontal com o produto mais à direita. O texto do cardápio ficará protegido e alinhado à esquerda.</p>
            <label className="block">
              <span className="block text-xs font-semibold text-ink-muted mb-1.5">Link da imagem do banner</span>
              <input type="url" value={bannerUrl} onChange={(event) => { setBannerUrl(event.target.value); setSaved(false); }} placeholder="https://exemplo.com/banner.jpg"
                className="w-full px-3 py-2.5 rounded-xl border border-line bg-surface-muted text-sm text-ink outline-none focus:border-brand-500" />
            </label>
            <div className="mt-3 overflow-hidden rounded-xl border border-line bg-surface-muted">
              {bannerUrl.trim() ? <img src={bannerUrl.trim()} alt="Prévia do banner" className="h-40 w-full object-cover object-right" /> : <div className="h-40 grid place-items-center text-xs text-ink-subtle">Cole o link de uma imagem para ver a prévia.</div>}
            </div>
            <p className="mt-2 text-[11px] text-ink-subtle">Recomendado: 1920 × 720 px. Formatos JPG, PNG ou WebP hospedados em um link público.</p>
          </section>
          <section className="rounded-2xl border border-line bg-surface p-4 md:p-5">

            <h3 className="font-bold text-ink mb-4">Textos de apresentação</h3>
            <div className="space-y-3">
              <TextField label="Chamada pequena" value={config.chamada || ""} onChange={(v) => update("chamada", v)} maxLength={70} />
              <TextField label="Título principal" help="Use | para definir a quebra e destacar a segunda parte." value={config.titulo || ""} onChange={(v) => update("titulo", v)} maxLength={70} />
              <label className="block">
                <span className="block text-xs font-semibold text-ink-muted mb-1.5">Descrição</span>
                <textarea rows={3} value={config.descricao || ""} maxLength={180} onChange={(e) => update("descricao", e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-line bg-surface-muted text-sm text-ink outline-none focus:border-brand-500" />
              </label>
            </div>
          </section>
        </div>

        <aside className="xl:sticky xl:top-24 rounded-2xl border border-line bg-surface p-3 md:p-4">
          <div className="flex items-center justify-between mb-3 px-1">
            <strong className="text-sm text-ink">Prévia da identidade</strong>
            <span className="text-[10px] uppercase tracking-wider text-ink-subtle">{selected.nome}</span>
          </div>
          <div className="overflow-hidden border border-white/10 shadow-2xl"
            style={{
              background: config.cor_fundo,
              color: previewText,
              borderRadius: RADII[config.bordas || "suaves"],
              fontFamily: bodyFont,
            }}>
            <div className="h-7 flex items-center justify-center text-[8px] font-extrabold uppercase tracking-widest"
              style={{ background: config.cor_primaria, color: isLight ? "#fff" : "#120b07" }}>Pedido direto · atendimento mais rápido</div>
            <div className="h-10 px-4 flex items-center justify-between border-b border-current/10">
              <strong className="text-[10px]">🍕 {pizzaria.nome}</strong>
              <span className="text-[8px] px-2 py-1 border border-current/20" style={{ borderRadius: RADII[config.bordas || "suaves"] }}>Sacola 0</span>
            </div>
            <div className="min-h-[270px] p-6 flex items-end relative bg-cover bg-center"
              style={{ backgroundImage: bannerUrl.trim() ? `linear-gradient(90deg, ${config.cor_fundo}f2 10%, ${config.cor_fundo}55), url(${bannerUrl.trim()})` : `linear-gradient(135deg, ${config.cor_fundo}, ${config.cor_secundaria}66)`, backgroundPosition: "right center" }}>
              <div className="relative max-w-[330px]">
                <p className="text-[8px] font-bold tracking-[.18em] mb-2" style={{ color: config.cor_primaria }}>{config.chamada}</p>
                <h4 className="text-[36px] leading-[.9]" style={{ fontFamily: titleFont }}>
                  {tituloPartes[0]}<br/><em className="not-italic" style={{ color: config.cor_primaria }}>{tituloPartes.slice(1).join(" ")}</em>
                </h4>
                <p className="text-[10px] leading-relaxed mt-3 max-w-[260px]" style={{ color: previewMuted }}>{config.descricao}</p>
                <button type="button" className="mt-4 px-4 py-2 text-[9px] font-bold"
                  style={{ background: config.cor_primaria, color: isLight ? "#fff" : "#130b06", borderRadius: RADII[config.bordas || "suaves"] }}>Ver cardápio →</button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 p-3">
              {["Pizza da casa", "Combo especial"].map((name, i) => (
                <div key={name} className="border border-current/10 p-2" style={{ borderRadius: RADII[config.bordas || "suaves"], background: isLight ? "#fffaf2" : "#ffffff08" }}>
                  <div className="h-12 mb-2" style={{ borderRadius: RADII[config.bordas || "suaves"], background: `linear-gradient(135deg, ${config.cor_primaria}${i ? "55" : "99"}, ${config.cor_secundaria}88)` }} />
                  <strong className="block text-[9px]">{name}</strong><span className="text-[8px]" style={{ color: config.cor_primaria }}>R$ {i ? "42,90" : "59,90"}</span>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>

      {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 text-red-300 px-4 py-3 text-sm">{error}</div>}
      <div className="sticky bottom-3 flex justify-end pointer-events-none">
        <button type="button" onClick={save} disabled={saving || !changed}
          className="pointer-events-auto inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-brand-gradient text-white text-sm font-bold shadow-brand disabled:opacity-50 disabled:shadow-none">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
          {saving ? "Salvando..." : saved ? "Tema salvo" : "Salvar tema"}
        </button>
      </div>
      </> : <PromocoesCardapioPanel pizzariaId={pizzaria.id} onUpdated={onUpdated} />}
    </div>
  );
}

function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }> }) {
  return <label className="block"><span className="block text-xs font-semibold text-ink-muted mb-1.5">{label}</span><select value={value} onChange={(e) => onChange(e.target.value)} className="w-full px-3 py-2.5 rounded-xl border border-line bg-surface-muted text-sm text-ink outline-none focus:border-brand-500">{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>;
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return <label className="block"><span className="block text-xs font-semibold text-ink-muted mb-1.5">{label}</span><span className="flex items-center gap-2 px-2 py-2 rounded-xl border border-line bg-surface-muted"><input type="color" value={value} onChange={(e) => { setDraft(e.target.value); onChange(e.target.value); }} className="w-9 h-9 rounded-lg border-0 bg-transparent p-0 cursor-pointer" /><input value={draft} onChange={(e) => { const next = e.target.value; if (/^#[0-9a-fA-F]{0,6}$/.test(next)) { setDraft(next); if (/^#[0-9a-fA-F]{6}$/.test(next)) onChange(next); } }} onBlur={() => setDraft(value)} className="min-w-0 flex-1 bg-transparent border-0 text-xs font-mono text-ink uppercase outline-none" /></span></label>;
}

function TextField({ label, help, value, onChange, maxLength }: { label: string; help?: string; value: string; onChange: (value: string) => void; maxLength: number }) {
  return <label className="block"><span className="block text-xs font-semibold text-ink-muted mb-1.5">{label}</span><input value={value} maxLength={maxLength} onChange={(e) => onChange(e.target.value)} className="w-full px-3 py-2.5 rounded-xl border border-line bg-surface-muted text-sm text-ink outline-none focus:border-brand-500" />{help && <small className="block text-[10px] text-ink-subtle mt-1">{help}</small>}</label>;
}
