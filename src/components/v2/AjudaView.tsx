/**
 * Central de Ajuda do painel da pizzaria.
 *
 * Conteúdo em dados (SECOES e DUVIDAS), para a busca varrer tudo: título,
 * descrição e palavras-chave de cada tópico, sem acento e sem diferenciar
 * maiúsculas. Atualizada em 30/09 com o que entrou: app do entregador, código
 * de entrega, valor por entrega, chat interno, alarme de pedido, Pix manual,
 * proteção do número do WhatsApp e a nova ficha de clientes.
 */
import React, { useMemo, useState } from "react";
import {
  Bike, Bot, ChevronRight, ClipboardList, Globe, LifeBuoy, MessageSquare, Palette,
  ReceiptText, Rocket, Search, ShieldCheck, Smartphone, Store, TrendingUp, Users, UtensilsCrossed, X,
} from "lucide-react";

interface Topico {
  titulo: string;
  descricao: string;
  /** Termos extras que a busca também considera (sinônimos, como a pessoa pergunta). */
  palavras?: string;
}

interface Secao {
  id: string;
  titulo: string;
  resumo: string;
  onde?: string;
  icon: React.ComponentType<{ className?: string }>;
  grupo: "operacao" | "config" | "conta";
  topicos: Topico[];
}

const SECOES: Secao[] = [
  {
    id: "pedidos",
    titulo: "Pedidos",
    resumo: "Quadro da cozinha, alarme e conferência de pagamento.",
    onde: "Menu › Pedidos",
    icon: ClipboardList,
    grupo: "operacao",
    topicos: [
      { titulo: "Fluxo do pedido", descricao: "Recebido → Aceito → No forno → Pronto para entrega → A caminho → Entregue. Na retirada, o pedido fica pronto para o cliente buscar. Cada mudança avisa o cliente pelo WhatsApp.", palavras: "status kanban etapas coluna" },
      { titulo: "Pedidos de hoje", descricao: "O quadro mostra só os pedidos do dia. Pedidos antigos ficam em Análise › Histórico. Conversas que ainda não viraram pedido aparecem no aviso \"N conversas ainda sem pedido\", e não como card vazio.", palavras: "ontem antigo sumiu rascunho" },
      { titulo: "Cards compactos", descricao: "Cada card mostra número, cliente, total e status. Toque em \"Detalhes\" para ver itens, endereço e ações. Cada coluna tem rolagem própria, então vários pedidos na mesma coluna ficam visíveis.", palavras: "card pequeno rolar coluna" },
      { titulo: "Alarme de pedido novo", descricao: "Quando um pedido é fechado (WhatsApp ou cardápio digital), o painel toca um bipe a cada 4 segundos e mostra a faixa \"Pedido novo\" até alguém clicar em \"Ver pedido\" ou \"Silenciar\". Deixe o volume do computador ligado.", palavras: "som barulho notificação bipe silenciar" },
      { titulo: "Pix manual: conferir o comprovante", descricao: "Se a loja recebe por Pix próprio, a atendente pede o comprovante ao cliente e o painel avisa. Confira no seu banco e aprove ou recuse o pagamento no card do pedido.", palavras: "comprovante pix conferir pagamento" },
      { titulo: "Conferência antes da cozinha", descricao: "Com a opção \"Conferir pedidos antes da cozinha\" ligada (Meu Negócio › Atendente), o pedido fechado pela IA espera alguém da equipe aprovar no painel antes de ir para o preparo.", palavras: "aprovar revisar conferir" },
      { titulo: "Código de entrega", descricao: "Quando o pedido sai para entrega, o cliente recebe no WhatsApp um código de 4 números. O entregador só confirma a entrega com esse código (ou justificando a falta dele, e isso fica no histórico do pedido).", palavras: "codigo 4 digitos confirmar entrega senha" },
    ],
  },
  {
    id: "conversas",
    titulo: "Conversas e chat interno",
    resumo: "WhatsApp em tempo real e as perguntas da atendente para a equipe.",
    onde: "Menu › Conversas",
    icon: MessageSquare,
    grupo: "operacao",
    topicos: [
      { titulo: "Conversas em tempo real", descricao: "Veja as mensagens do cliente e da atendente conforme chegam. Mensagens automáticas (confirmação do cardápio digital, avisos de status) aparecem formatadas, como o cliente vê.", palavras: "whatsapp mensagens" },
      { titulo: "Assumir a conversa", descricao: "Desligue o bot na conversa para falar pessoalmente com o cliente e religue quando terminar. O que você escrever entra na memória da atendente, para ela continuar do ponto certo.", palavras: "humano pausar bot atender" },
      { titulo: "Pedido de atendente humano", descricao: "Quando o cliente pede para falar com uma pessoa, o painel mostra uma faixa de atenção com som que se repete, em qualquer tela, até alguém abrir a conversa.", palavras: "transferir humano alerta" },
      { titulo: "Chat interno", descricao: "Quando a atendente não sabe responder algo (ex.: \"tem estacionamento?\"), ela avisa o cliente que vai confirmar e manda a pergunta para a aba Chat interno. Você responde lá e ela repassa ao cliente. Se ninguém responder em 5 minutos, ela avisa o cliente.", palavras: "chamado pergunta duvida equipe interno" },
      { titulo: "Base de conhecimento", descricao: "Ao responder um chamado, você pode salvar a resposta. Da próxima vez que alguém perguntar o mesmo, a atendente responde sozinha. Veja e edite em Meu Negócio › Atendente › Base de conhecimento.", palavras: "resposta salva conhecimento" },
    ],
  },
  {
    id: "clientes",
    titulo: "Clientes",
    resumo: "Contas do cardápio digital, compras e acesso.",
    onde: "Menu › Clientes",
    icon: Users,
    grupo: "operacao",
    topicos: [
      { titulo: "Ficha do cliente", descricao: "Toque no cliente para ver pedidos, total gasto, ticket médio, o que ele mais pede e a forma de pagamento que costuma usar. Os números vêm dos pedidos reais, inclusive os feitos pelo cardápio digital.", palavras: "historico compras gasto favoritos" },
      { titulo: "Falar com o cliente", descricao: "Na ficha há os botões WhatsApp e Copiar telefone. Cada pedido do histórico abre com itens, valores, entrega e endereço.", palavras: "contato telefone" },
      { titulo: "Redefinir senha ou excluir conta", descricao: "Ficam em \"Gerenciar conta\", no fim da ficha. A exclusão apaga os dados pessoais e mantém os pedidos no histórico da loja.", palavras: "senha esqueceu acesso apagar" },
    ],
  },
  {
    id: "analise",
    titulo: "Análise e histórico",
    resumo: "Faturamento, horários de pico e pedidos passados.",
    onde: "Menu › Análise",
    icon: TrendingUp,
    grupo: "operacao",
    topicos: [
      { titulo: "Visão geral", descricao: "Pedidos, faturamento, ticket médio, cancelamentos, vendas por dia, horários de pico e produtos mais vendidos, em 7, 30 ou 90 dias.", palavras: "faturamento vendas relatorio metricas" },
      { titulo: "Histórico de pedidos", descricao: "Todos os pedidos passados com filtros. Ao abrir um pedido, você vê itens com preço, eventos (quem mudou o status e quando) e o botão para chamar o cliente.", palavras: "pedido antigo buscar" },
    ],
  },
  {
    id: "atendente",
    titulo: "Atendente de IA",
    resumo: "Como ela atende, o que configurar e como testar.",
    onde: "Meu Negócio › Atendente",
    icon: Bot,
    grupo: "config",
    topicos: [
      { titulo: "Prontidão do atendimento", descricao: "No topo da página, a lista mostra o que falta configurar: cardápio, WhatsApp conectado, horários, pagamento online coerente, descrições do cardápio e se o número está em aquecimento.", palavras: "diagnostico saude pronto verificar" },
      { titulo: "Preços sempre do cardápio", descricao: "A atendente só usa produtos, tamanhos e preços cadastrados. Se o cliente pede algo que não existe (ex.: Coca 1 litro quando a loja só tem a de 2 litros), ela diz que não tem e oferece o que há. Cadastre o volume no nome das bebidas.", palavras: "preco errado produto nao tem bebida volume litro" },
      { titulo: "Confirmação do que foi anotado", descricao: "A cada item, o cliente vê \"✅ Anotei: 1x Calabresa (G)\" com o que está de fato no pedido. O resumo final traz itens, entrega, endereço, pagamento e troco, e pede \"Posso fechar?\".", palavras: "resumo anotei confirmar" },
      { titulo: "Troco", descricao: "No pagamento em dinheiro na entrega, a atendente pergunta se o cliente precisa de troco e para quanto. O valor aparece no pedido para o entregador.", palavras: "dinheiro troco" },
      { titulo: "Resgates automáticos", descricao: "Lembrete para quem viu o resumo e não confirmou, resgate de carrinho parado e pesquisa de satisfação após a entrega. Ligue ou desligue em Resgates automáticos.", palavras: "lembrete carrinho abandonado pesquisa nps satisfacao" },
      { titulo: "Testar a atendente", descricao: "Use o teste no fim da página para conversar com a atendente como se fosse um cliente. Nada é enviado ao WhatsApp, nenhum pedido é criado e nada é cobrado.", palavras: "simular teste playground" },
    ],
  },
  {
    id: "cardapio",
    titulo: "Cardápio",
    resumo: "Produtos, tamanhos, descrições e disponibilidade.",
    onde: "Menu › Cardápio",
    icon: UtensilsCrossed,
    grupo: "config",
    topicos: [
      { titulo: "Cadastro de produtos", descricao: "Categorias, preços, fotos, tamanhos e adicionais. Tudo que a atendente e o cardápio digital vendem sai daqui.", palavras: "produto preco tamanho" },
      { titulo: "Descrições", descricao: "Cada produto deve ter a própria descrição. Descrições repetidas ou que citam produtos de outra categoria aparecem como alerta na Prontidão do atendimento, porque confundem a atendente.", palavras: "descricao ingredientes" },
      { titulo: "Pausar produto esgotado", descricao: "Desative o item sem excluir. A atendente avisa o cliente que acabou e oferece outro.", palavras: "esgotado acabou indisponivel" },
    ],
  },
  {
    id: "negocio",
    titulo: "Meu Negócio",
    resumo: "WhatsApp, pagamentos, entrega e horários.",
    onde: "Meu Negócio › Geral",
    icon: Store,
    grupo: "config",
    topicos: [
      { titulo: "WhatsApp e bot", descricao: "Conecte o número pelo QR Code e ligue ou desligue a atendente para a loja toda. Se o WhatsApp desconectar, o painel avisa.", palavras: "qr code conectar desconectou numero" },
      { titulo: "Formas de pagamento", descricao: "Receba online pelo Asaas ou Mercado Pago, pelo seu próprio Pix (você confere o comprovante) ou só na entrega/retirada. No Pix manual, cadastre o código copia e cola.", palavras: "pix cartao asaas mercado pago pagamento online" },
      { titulo: "Taxas de entrega", descricao: "Em Logística e entregas: taxa fixa padrão e a tabela por bairro. A atendente e o cardápio digital usam essa tabela.", palavras: "frete taxa bairro" },
      { titulo: "Endereço completo da loja", descricao: "Informe rua, número, bairro e cidade. A rota do entregador e a localização dos endereços dos clientes partem dele.", palavras: "endereco loja rota cidade" },
      { titulo: "Horários", descricao: "Abertura e fechamento por dia e a mensagem automática de fora do horário.", palavras: "horario aberto fechado" },
    ],
  },
  {
    id: "entregadores",
    titulo: "Entregadores e app",
    resumo: "App Android, rota, localização e valor por entrega.",
    onde: "Menu › Entregadores",
    icon: Bike,
    grupo: "config",
    topicos: [
      { titulo: "Cadastrar entregador", descricao: "Crie o acesso com nome, e-mail e senha. O entregador entra no app (ou no link do entregador) com esses dados.", palavras: "motoboy acesso login" },
      { titulo: "Instalar o app no Android", descricao: "No cartão \"App do entregador\", copie o link e envie ao entregador. No celular, ele baixa, permite \"instalar apps desta fonte\", entra com o acesso e permite localização e notificações. Não há versão para iPhone: nesse caso, use o link do entregador no navegador.", palavras: "apk baixar instalar android celular iphone" },
      { titulo: "Turno e notificações", descricao: "Com o turno ligado, o app avisa de entrega nova mesmo com a tela desligada e compartilha a localização. Se o app for fechado à força, os avisos param até ele ser aberto de novo.", palavras: "online turno aviso notificacao" },
      { titulo: "Rota", descricao: "\"Ver rota\" mostra a ordem das paradas: primeiro a retirada na pizzaria, depois as entregas pela mais próxima. A rota completa abre no Google Maps; cada parada tem o botão do Waze.", palavras: "rota waze google maps mapa ordem" },
      { titulo: "Localização do entregador", descricao: "Na lista de entregadores aparece \"Localização há X min · ver no mapa\" enquanto o turno está ligado.", palavras: "onde esta gps localizacao" },
      { titulo: "Valor por entrega", descricao: "No cartão \"Valor por entrega\", informe quanto o entregador ganha por entrega e ative. Ele passa a ver ganhos e histórico com valores no app, e a lista mostra os ganhos de hoje. Mudar o valor vale só para as próximas entregas.", palavras: "repasse pagamento motoboy ganho valor fixo" },
      { titulo: "Autoatribuição", descricao: "Ligada, o entregador pode assumir sozinho os pedidos prontos sem entregador. Desligada, só a pizzaria distribui.", palavras: "assumir pegar pedido distribuir" },
    ],
  },
  {
    id: "temas",
    titulo: "Temas, banners e cupons",
    resumo: "Visual do cardápio digital e promoções.",
    onde: "Menu › Temas",
    icon: Palette,
    grupo: "config",
    topicos: [
      { titulo: "Identidade visual", descricao: "Escolha um estilo e ajuste cores, fontes e botões do cardápio digital, com prévia ao vivo.", palavras: "cores tema layout" },
      { titulo: "Banners e cupons", descricao: "Banners no topo do cardápio e cupons em % ou valor fixo, com valor mínimo e validade.", palavras: "promocao desconto cupom" },
    ],
  },
  {
    id: "digital",
    titulo: "Cardápio digital",
    resumo: "O site de pedidos ligado ao painel.",
    icon: Globe,
    grupo: "conta",
    topicos: [
      { titulo: "Pedidos pelo site", descricao: "O cliente monta o pedido no celular, com taxa de entrega, cupom e forma de pagamento. O pedido entra confirmado no quadro e toca o alarme.", palavras: "site link online" },
      { titulo: "Confirmação no WhatsApp", descricao: "O cliente recebe o resumo do pedido no WhatsApp, com itens, entrega, pagamento e as observações (ex.: troco).", palavras: "confirmacao mensagem" },
    ],
  },
  {
    id: "whatsapp",
    titulo: "Proteção do número do WhatsApp",
    resumo: "O que o sistema faz e o que a loja deve fazer para evitar bloqueio.",
    icon: ShieldCheck,
    grupo: "conta",
    topicos: [
      { titulo: "O que o sistema já faz", descricao: "Mensagens automáticas só vão para quem falou com a loja nas últimas 24 horas, com limite por hora e intervalo entre envios. Quem escreve \"pare de me mandar mensagem\" não recebe mais mensagens automáticas.", palavras: "banimento bloqueio ban spam" },
      { titulo: "Número novo (aquecimento)", descricao: "Nos primeiros 14 dias do número no sistema, não saem resgate de carrinho nem pesquisa de satisfação. A Prontidão do atendimento mostra até quando.", palavras: "chip novo aquecimento" },
      { titulo: "Boas práticas da loja", descricao: "Use um chip só para a loja, com WhatsApp Business completo (foto, endereço, horário). Não mande promoções em massa por esse número e divulgue o link para o cliente chamar primeiro.", palavras: "campanha promocao massa" },
    ],
  },
  {
    id: "assinatura",
    titulo: "Assinatura",
    resumo: "Plano, faturas e limite de atendimentos.",
    onde: "Menu › Assinatura",
    icon: ReceiptText,
    grupo: "conta",
    topicos: [
      { titulo: "Plano e faturas", descricao: "Acompanhe o limite de atendimentos do mês, as faturas e o vencimento. Pague pelo Pix da fatura.", palavras: "mensalidade fatura plano pagar" },
      { titulo: "Atraso", descricao: "Com a fatura atrasada, o painel mostra um aviso. Depois do prazo, o atendimento pode ser suspenso até a regularização.", palavras: "atrasado suspenso bloqueado" },
    ],
  },
];

const DUVIDAS: Topico[] = [
  { titulo: "O app do entregador não mostra a tela nova", descricao: "No rodapé do app aparece \"Versão da tela\". Se a data for antiga, feche e abra o app. Se continuar, vá em Configurações do Android › Apps › PizzaBot Entregador › Armazenamento › Limpar cache.", palavras: "atualizar versao app antigo" },
  { titulo: "O cliente diz que não recebeu o código de entrega", descricao: "O código vai na mensagem de \"saiu para entrega\" no WhatsApp. Se ele não achar, o entregador toca em \"O cliente não tem o código\" e informa o motivo, que fica registrado no pedido.", palavras: "codigo entrega nao chegou" },
  { titulo: "O botão Ligar abre o WhatsApp", descricao: "O Android está usando o WhatsApp como app padrão de ligação. Troque em Configurações › Apps › Apps padrão › Telefone.", palavras: "ligar telefone chamada" },
  { titulo: "O alarme de pedido não para", descricao: "Clique em \"Ver pedido\" ou \"Silenciar\" na faixa laranja do topo. O alarme é de propósito: repete até alguém ver o pedido.", palavras: "som alarme barulho parar" },
  { titulo: "Não vejo a localização do entregador", descricao: "Ela aparece só com o turno ligado no app e com a permissão de localização concedida. No app, se faltar permissão, aparece o botão \"Abrir configurações\".", palavras: "gps localizacao entregador" },
  { titulo: "Um pedido de ontem não aparece em Pedidos", descricao: "O quadro mostra só os de hoje. Procure em Análise › Histórico.", palavras: "pedido sumiu antigo ontem" },
  { titulo: "A atendente respondeu algo errado", descricao: "Confira o cadastro do produto (nome, tamanhos, preço e descrição) e a Prontidão do atendimento. Se for uma informação da loja, responda pelo Chat interno e salve na Base de conhecimento.", palavras: "erro resposta errada ia" },
];

const normalizar = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const SUGESTOES = ["app do entregador", "código de entrega", "valor por entrega", "chat interno", "pix manual", "alarme"];

type Resultado = { secao: Secao | null; topico: Topico };

/** Destaca os trechos buscados no texto. */
function Destaque({ texto, termos }: { texto: string; termos: string[] }) {
  if (!termos.length) return <>{texto}</>;
  const norm = normalizar(texto);
  const marcas: Array<[number, number]> = [];
  for (const t of termos) {
    let i = norm.indexOf(t);
    while (i >= 0 && t) {
      marcas.push([i, i + t.length]);
      i = norm.indexOf(t, i + t.length);
    }
  }
  if (!marcas.length) return <>{texto}</>;
  marcas.sort((a, b) => a[0] - b[0]);
  const partes: React.ReactNode[] = [];
  let pos = 0;
  marcas.forEach(([ini, fim], k) => {
    if (ini < pos) return;
    partes.push(texto.slice(pos, ini));
    partes.push(<mark key={k} className="rounded bg-orange-500/30 px-0.5 text-orange-100">{texto.slice(ini, fim)}</mark>);
    pos = fim;
  });
  partes.push(texto.slice(pos));
  return <>{partes}</>;
}

export function AjudaView() {
  const [busca, setBusca] = useState("");
  const [aberta, setAberta] = useState<Secao | null>(null);

  const termos = useMemo(
    () => normalizar(busca).split(/\s+/).filter((t) => t.length >= 2),
    [busca],
  );

  const resultados = useMemo<Resultado[]>(() => {
    if (!termos.length) return [];
    const todos: Resultado[] = [
      ...SECOES.flatMap((s) => s.topicos.map((t) => ({ secao: s, topico: t }))),
      ...DUVIDAS.map((t) => ({ secao: null, topico: t })),
    ];
    return todos
      .map((r) => {
        const alvo = normalizar(`${r.topico.titulo} ${r.topico.descricao} ${r.topico.palavras ?? ""} ${r.secao?.titulo ?? "duvidas"}`);
        const titulo = normalizar(r.topico.titulo);
        if (!termos.every((t) => alvo.includes(t))) return null;
        const pontos = termos.reduce((s, t) => s + (titulo.includes(t) ? 3 : 0) + (normalizar(r.topico.palavras ?? "").includes(t) ? 1 : 0), 0);
        return { r, pontos };
      })
      .filter((x): x is { r: Resultado; pontos: number } => x !== null)
      .sort((a, b) => b.pontos - a.pontos)
      .map((x) => x.r);
  }, [termos]);

  const grupos: Array<{ id: Secao["grupo"]; titulo: string; resumo: string }> = [
    { id: "operacao", titulo: "Operação do dia a dia", resumo: "Pedidos, conversas e clientes." },
    { id: "config", titulo: "Configuração da loja", resumo: "Atendente, cardápio, negócio e entregadores." },
    { id: "conta", titulo: "Conta e crescimento", resumo: "Cardápio digital, proteção do WhatsApp e assinatura." },
  ];

  return (
    <div className="pzb-page mx-auto max-w-6xl space-y-6">
      {/* Cabeçalho com busca */}
      <div className="pzb-section p-5 md:p-6">
        <div className="flex items-center gap-3.5">
          <div>
            <h2 className="text-base font-semibold text-ink">Central de Ajuda</h2>
            <p className="mt-0.5 text-sm text-ink-muted">Como usar cada parte do PizzaBot. Busque um assunto ou abra uma seção.</p>
          </div>
        </div>
        <div className="relative mt-5">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-subtle" />
          <input
            id="busca-ajuda"
            type="text"
            role="searchbox"
            aria-label="Buscar um assunto na ajuda"
            name="busca-ajuda"
            autoComplete="off"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Ex.: código de entrega, valor por entrega, pix manual…"
            className="h-12 w-full rounded-xl border border-line bg-surface-muted pl-12 pr-11 text-sm text-white outline-none transition placeholder:text-ink-subtle focus:border-orange-500/50"
          />
          {busca && (
            <button type="button" onClick={() => setBusca("")} aria-label="Limpar busca"
              className="absolute right-3 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-lg text-ink-muted hover:bg-surface-elevated hover:text-ink">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        {!busca && (
          <div className="mt-3 flex flex-wrap gap-2">
            {SUGESTOES.map((s) => (
              <button key={s} type="button" onClick={() => setBusca(s)}
                className="rounded-full border border-line bg-surface-muted px-3 py-1 text-xs font-semibold text-ink-muted hover:border-orange-500/40 hover:text-orange-300">
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {termos.length > 0 ? (
        /* Resultados da busca */
        <section className="space-y-3">
          <p className="text-sm text-ink-muted">
            {resultados.length === 0
              ? `Nada encontrado para "${busca.trim()}".`
              : `${resultados.length} resultado${resultados.length === 1 ? "" : "s"} para "${busca.trim()}"`}
          </p>
          {resultados.length === 0 ? (
            <div className="rounded-xl border border-dashed border-line p-8 text-center">
              <p className="text-sm text-ink-muted">Tente outra palavra, como "entrega", "pagamento" ou "WhatsApp".</p>
            </div>
          ) : (
            resultados.map(({ secao, topico }, i) => {
              const Icon = secao?.icon ?? LifeBuoy;
              return (
                <article key={`${secao?.id ?? "duvida"}-${i}`} className="rounded-xl border border-line bg-surface p-4">
                  <div className="flex items-center gap-2 text-xs font-semibold text-orange-400">
                    <Icon className="h-3.5 w-3.5" />
                    {secao ? secao.titulo : "Dúvidas frequentes"}
                    {secao?.onde && <span className="font-normal text-ink-subtle">· {secao.onde}</span>}
                  </div>
                  <h3 className="mt-1.5 text-sm font-bold text-white"><Destaque texto={topico.titulo} termos={termos} /></h3>
                  <p className="mt-1 text-sm leading-relaxed text-ink-muted"><Destaque texto={topico.descricao} termos={termos} /></p>
                </article>
              );
            })
          )}
        </section>
      ) : (
        <>
          {/* Visão geral */}
          <div className="pzb-section p-5">
            <div className="flex items-center gap-3">
              <div className="shrink-0 text-brand-400">
                <Rocket className="h-5 w-5 text-orange-400" />
              </div>
              <div>
                <h2 className="text-base font-bold text-white">Visão geral</h2>
                <p className="text-sm text-ink-muted">Do pedido no WhatsApp à entrega, em um painel só.</p>
              </div>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              {[
                { t: "A atendente vende", d: "Conversa pelo WhatsApp, usa só o seu cardápio e seus preços, monta o pedido, calcula a entrega e confirma com o cliente." },
                { t: "A loja acompanha", d: "O pedido entra no quadro com alarme. A equipe prepara, aprova pagamentos e responde as dúvidas que a atendente não sabe." },
                { t: "O entregador entrega", d: "Pelo app Android: rota, localização ao vivo, código de entrega e, se a loja quiser, os ganhos de cada entrega." },
              ].map((c) => (
                <div key={c.t} className="border-t border-line pt-4">
                  <h3 className="text-sm font-bold text-white">{c.t}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-ink-muted">{c.d}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Seções por grupo */}
          <div className="grid gap-5 lg:grid-cols-3">
            {grupos.map((g) => (
              <div key={g.id} className="pzb-section p-5">
                <div>
                  <h2 className="text-base font-semibold text-ink">{g.titulo}</h2>
                  <p className="mt-0.5 text-sm text-ink-muted">{g.resumo}</p>
                </div>
                {SECOES.filter((s) => s.grupo === g.id).map((s) => {
                  const Icon = s.icon;
                  return (
                    <button key={s.id} type="button" onClick={() => setAberta(s)}
                      className="group flex w-full items-center gap-3 border-b border-line py-4 text-left transition-colors last:border-b-0 hover:bg-surface-muted">
                      <div className="shrink-0 text-brand-400">
                        <Icon className="h-4.5 w-4.5 text-orange-400" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-white transition-colors group-hover:text-orange-400">{s.titulo}</p>
                        <p className="mt-0.5 text-xs text-ink-muted">{s.resumo}</p>
                      </div>
                      <ChevronRight className="h-4 w-4 shrink-0 text-ink-subtle group-hover:text-ink" />
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          {/* Dúvidas frequentes */}
          <div className="pzb-section p-5">
            <div className="flex items-center gap-3">
              <div className="shrink-0 text-brand-400">
                <LifeBuoy className="h-5 w-5 text-orange-400" />
              </div>
              <h2 className="text-base font-bold text-white">Dúvidas frequentes</h2>
            </div>
            <div className="mt-4 divide-y divide-line">
              {DUVIDAS.map((d) => (
                <details key={d.titulo} className="group py-3">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-white">
                    {d.titulo}
                    <ChevronRight className="h-4 w-4 shrink-0 text-ink-subtle transition-transform group-open:rotate-90" />
                  </summary>
                  <p className="mt-2 text-sm leading-relaxed text-ink-muted">{d.descricao}</p>
                </details>
              ))}
            </div>
          </div>

          <p className="flex items-center justify-center gap-2 pt-1 text-center text-xs text-ink-subtle">
            <Smartphone className="h-3.5 w-3.5" />
            Ainda com dúvida? Fale com o suporte da plataforma.
          </p>
        </>
      )}

      {/* Detalhe da seção */}
      {aberta && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setAberta(null)}>
          <div role="dialog" aria-modal="true" aria-labelledby="ajuda-secao-title" className="w-full max-w-lg overflow-hidden rounded-xl border border-line bg-surface p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-line pb-4">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-xl border border-orange-500/20 bg-orange-500/10">
                  <aberta.icon className="h-5 w-5 text-orange-400" />
                </div>
                <div>
                  <h3 id="ajuda-secao-title" className="text-base font-semibold text-ink">{aberta.titulo}</h3>
                  <p className="mt-0.5 text-xs text-ink-muted">{aberta.onde ? `${aberta.onde} · ` : ""}{aberta.resumo}</p>
                </div>
              </div>
              <button type="button" onClick={() => setAberta(null)} aria-label="Fechar"
                className="rounded-lg p-1.5 text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-5 max-h-[60vh] space-y-3 overflow-y-auto pr-1">
              {aberta.topicos.map((t) => (
                <div key={t.titulo} className="space-y-1 border-b border-line pb-4 last:border-b-0">
                  <h4 className="flex items-center gap-2 text-sm font-bold text-white">
                    <span className="h-2 w-2 shrink-0 rounded-full bg-brand-700" />{t.titulo}
                  </h4>
                  <p className="pl-4 text-sm leading-relaxed text-ink-muted">{t.descricao}</p>
                </div>
              ))}
            </div>
            <div className="mt-6 flex justify-end border-t border-line pt-4">
              <button type="button" onClick={() => setAberta(null)}
                className="rounded-xl bg-brand-700 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-brand-800">
                Entendi
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
