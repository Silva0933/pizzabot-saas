import React, { useState, useEffect } from "react";
import type { User as SupabaseUser } from "@supabase/supabase-js";
import { AnimatePresence, motion } from "motion/react";
import {
  Pizza,
  Bot,
  LayoutDashboard,
  ShoppingBag,
  MessageSquare,
  UtensilsCrossed,
  DollarSign,
  Settings,
  AlertCircle,
  Volume2,
  X,
  LogOut,
  Sparkles,
} from "lucide-react";
import { Pizzeria, Product, Customer, Order, Conversation, OrderStatus, OrderItem, Operator } from "./types";
import { playNewOrderAlert } from "./components/AudioAlert";
import { DashboardView } from "./components/DashboardView";
import { KanbanView } from "./components/KanbanView";
import { ConversationsView } from "./components/ConversationsView";
import { MenuManagementView } from "./components/MenuManagementView";
import { FinancialView } from "./components/FinancialView";
import { SettingsView } from "./components/SettingsView";
import { ClientSimulator } from "./components/ClientSimulator";
import { TestAgentModal } from "./components/TestAgentModal";
import { OnboardingWizard } from "./components/OnboardingWizard";
import { SaasAdminView } from "./components/SaasAdminView";
import { QuickSetupView } from "./components/QuickSetupView";
import { supabase } from "./lib/supabase";
import { initNotifications, notify, requestNotificationPermission } from "./lib/notifications";

export default function App() {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<SupabaseUser | null>(null);
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  // (Onboarding state now lives in OnboardingWizard component)
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<string>("quickstart");
  const [pizzeria, setPizzeria] = useState<Pizzeria | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [operators, setOperators] = useState<Operator[]>([]);
  const [currentOperator, setCurrentOperator] = useState<Operator | null>(null);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [activeConvPhone, setActiveConvPhone] = useState<string | null>(null);

  // Manual Order Modal local states
  const [isManualOrderModalOpen, setIsManualOrderModalOpen] = useState(false);
  const [isTestAgentOpen, setIsTestAgentOpen] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [manualDeliveryType, setManualDeliveryType] = useState<'delivery' | 'retirada'>("delivery");
  const [manualAddress, setManualAddress] = useState("");
  const [manualNotes, setManualNotes] = useState("");
  const [manualPaymentMethod, setManualPaymentMethod] = useState<'pix' | 'cartao' | 'dinheiro'>("pix");
  const [manualPaymentStatus, setManualPaymentStatus] = useState<'pending' | 'approved'>("pending");
  const [orderItemSelections, setOrderItemSelections] = useState<Record<string, number>>({}); // productId -> qty

  // Kanban column names come from pizzeria.columnNames (DB-backed, customizable in Settings)
  const columnNames = (pizzeria?.columnNames as Record<OrderStatus, string>) || {
    novo: "Novos",
    confirmado: "Confirmados ✅",
    no_forno: "No Forno 🍕",
    a_caminho: "A Caminho 🏍️",
    entregue: "Entregues 📦",
    cancelado: "Cancelados ❌"
  };

  // Sound triggering helper state
  const [soundEnabled, setSoundEnabled] = useState(true);
  const soundEnabledRef = React.useRef(soundEnabled);
  const [notifPermission, setNotifPermission] = useState<NotificationPermission>("default");

  // Sync soundEnabled to ref so Realtime callbacks always use current value
  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);

  // Init notifications permission state (PRD 4.1)
  useEffect(() => {
    setNotifPermission(initNotifications());
  }, []);

  const handleEnableNotifications = async () => {
    const result = await requestNotificationPermission();
    setNotifPermission(result);
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setWorkspaceLoading(Boolean(data.session?.user));
      setAuthReady(true);
    });

    const { data: authSub } = supabase.auth.onAuthStateChange((event, session) => {
      // Ignorar eventos que NÃO representam mudança real de autenticação:
      // • TOKEN_REFRESHED — apenas renova o JWT em background (troca de aba, expiração)
      // • INITIAL_SESSION  — já tratado pelo getSession() acima; ignorar evita disparo duplo
      // Processar esses eventos setaria workspaceLoading=true sem que loadAllData() fosse
      // re-executado (user.id não muda), travando o spinner indefinidamente.
      if (event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') return;

      setUser(session?.user ?? null);
      setWorkspaceLoading(Boolean(session?.user));
      setAuthReady(true);
    });

    return () => authSub.subscription.unsubscribe();
  }, []);

  if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4 font-sans">
        <div className="bg-slate-800 rounded-2xl p-8 max-w-md w-full text-center border border-slate-700 shadow-2xl">
          <Pizza className="w-16 h-16 text-orange-500 mx-auto mb-6" />
          <h1 className="text-2xl font-bold text-white mb-3">Bem-vindo ao PizzaBot!</h1>
          <p className="text-slate-300 mb-6">
            As variáveis de ambiente do Supabase não foram encontradas.
          </p>
          <div className="bg-slate-900 rounded-lg p-4 text-left border border-slate-700 mb-6">
            <p className="text-xs text-slate-400 font-mono mb-2">Crie o arquivo .env na raiz do projeto:</p>
            <code className="text-[11px] text-emerald-400 font-mono block">VITE_SUPABASE_URL="https://..."</code>
            <code className="text-[11px] text-emerald-400 font-mono block">VITE_SUPABASE_ANON_KEY="ey..."</code>
          </div>
          <p className="text-sm text-slate-400">Após configurar, o servidor recarregará automaticamente.</p>
        </div>
      </div>
    );
  }

  // Data Mappers
  const defaultColumnNames: Record<string, string> = {
    novo: "Novos",
    confirmado: "Confirmados ✅",
    no_forno: "No Forno 🍕",
    a_caminho: "A Caminho 🏍️",
    entregue: "Entregues 📦",
    cancelado: "Cancelados ❌"
  };

  const mapPizzeria = (db: any): Pizzeria => ({
    id: db.id, name: db.nome, address: db.endereco, logoUrl: db.logo_url,
    instance: db.instancia, phoneAdmin: db.telefone_admin,
    plan: db.plano, botActiveGlobal: db.bot_ativo_global, promptPersonalized: db.prompt_personalizado,
    asaasApiKey: db.asaas_api_key, mpAccessToken: db.mp_access_token || '', gatewayPayment: db.gateway_pagamento || 'mercadopago',
    hoursOfOperation: db.horario_funcionamento || {}, messageDelivered: db.mensagem_entregue,
    statusMessages: db.mensagens_status || {},
    columnNames: { ...defaultColumnNames, ...(db.nomes_colunas || {}) }
  });
  
  const mapProduct = (db: any): Product => ({
    id: db.id, pizzeriaId: db.pizzaria_id, category: db.categoria, name: db.nome,
    description: db.descricao, price: Number(db.preco), available: db.disponivel,
    imageUrl: db.imagem_url, order: db.ordem
  });
  
  const mapCustomer = (db: any): Customer => ({
    id: db.id, pizzeriaId: db.pizzaria_id, phone: db.telefone, name: db.nome,
    defaultAddress: db.endereco_padrao, preferences: db.preferencias,
    orderHistory: db.historico_pedidos || [], totalOrders: db.total_pedidos,
    totalSpent: Number(db.total_gasto), lastVisit: db.ultima_visita
  });
  
  const mapOrder = (db: any): Order => ({
    id: db.id, pizzeriaId: db.pizzaria_id, customerId: db.cliente_id,
    customerName: db.clientes?.nome || 'Desconhecido', customerPhone: db.clientes?.telefone || 'N/A',
    orderNumber: db.numero_pedido,
    items: (db.itens || []).map((it: any) => ({
      qty:        it.qtd       ?? it.qty       ?? 0,
      name:       it.nome      ?? it.name      ?? '',
      priceUnit:  it.preco_unit ?? it.priceUnit ?? 0,
      observation: it.observacao ?? it.observation ?? ''
    })),
    totalValue: Number(db.valor_total),
    status: db.status, deliveryType: db.tipo, deliveryAddress: db.endereco_entrega,
    paymentMethod: db.forma_pagamento, paymentId: db.payment_id, paymentStatus: db.payment_status,
    paymentLink: db.link_pagamento, notes: db.observacoes, botActive: db.bot_ativo,
    createdAt: db.created_at, updatedAt: db.updated_at
  });
  
  const mapConversation = (db: any): Conversation => ({
    id: db.id, pizzeriaId: db.pizzaria_id, customerName: db.cliente_nome,
    customerPhone: db.cliente_telefone, lastMessage: db.last_message, lastTimestamp: db.last_timestamp,
    botActive: db.bot_ativo, status: db.status as any, messages: db.messages || []
  });

  const mapOperator = (db: any): Operator => ({
    id: db.id, pizzeriaId: db.pizzaria_id, userId: db.user_id, email: db.email,
    role: db.role, status: db.status, createdAt: db.created_at
  });

  // Initial load
  const loadAllData = async () => {
    setWorkspaceLoading(true);
    if (!authReady || !user) {
      setPizzeria(null);
      setProducts([]);
      setCustomers([]);
      setOrders([]);
      setConversations([]);
      setOperators([]);
      setCurrentOperator(null);
      setIsPlatformAdmin(false);
      setWorkspaceLoading(false);
      return;
    }

    try {
      const platformAdminRes = await supabase.rpc('is_platform_admin');
      const platformAdmin = Boolean(platformAdminRes.data);
      setIsPlatformAdmin(platformAdmin);

      if (platformAdmin) {
        setPizzeria(null);
        setProducts([]);
        setCustomers([]);
        setOrders([]);
        setConversations([]);
        setOperators([]);
        setCurrentOperator(null);
        setWorkspaceLoading(false);
        return;
      }

      const memberRes = await supabase
        .from('equipe_pizzaria')
        .select('*')
        .or(`user_id.eq.${user.id},email.eq.${user.email || ''}`)
        .order('created_at', { ascending: true })
        .limit(1);

      if (memberRes.error) console.error("Erro Equipe:", memberRes.error);

      const currentMember = memberRes.data?.[0];
      if (!currentMember) {
        setPizzeria(null);
        setProducts([]);
        setCustomers([]);
        setOrders([]);
        setConversations([]);
        setOperators([]);
        setCurrentOperator(null);
        setIsPlatformAdmin(false);
        setWorkspaceLoading(false);
        return;
      }

      setCurrentOperator(mapOperator(currentMember));

      const pizzeriaId = currentMember.pizzaria_id;
      const pizRes = await supabase.from('pizzarias').select('*').eq('id', pizzeriaId).single();

      if (pizRes.error) console.error("Erro Pizzeria:", pizRes.error);

      const selectedPizzeria = pizRes.data;
      if (!selectedPizzeria) {
        setPizzeria(null);
        setProducts([]);
        setCustomers([]);
        setOrders([]);
        setConversations([]);
        setOperators([]);
        setCurrentOperator(null);
        setIsPlatformAdmin(false);
        setWorkspaceLoading(false);
        return;
      }

      setPizzeria(mapPizzeria(selectedPizzeria));

      const [prodRes, custRes, ordRes, convRes, opRes] = await Promise.all([
        supabase.from('produtos').select('*').eq('pizzaria_id', pizzeriaId).order('ordem', { ascending: true }),
        supabase.from('clientes').select('*').eq('pizzaria_id', pizzeriaId),
        supabase.from('pedidos').select('*, clientes(nome, telefone)').eq('pizzaria_id', pizzeriaId).order('created_at', { ascending: false }),
        supabase.from('conversas').select('*').eq('pizzaria_id', pizzeriaId).order('last_timestamp', { ascending: false }),
        supabase.from('equipe_pizzaria').select('*').eq('pizzaria_id', pizzeriaId).order('created_at', { ascending: true })
      ]);

      if (prodRes.error) console.error("Erro Produtos:", prodRes.error);
      if (custRes.error) console.error("Erro Clientes:", custRes.error);
      if (ordRes.error) console.error("Erro Pedidos:", ordRes.error);
      if (opRes.error) console.error("Erro Equipe:", opRes.error);
      
      if (prodRes.data) setProducts(prodRes.data.map(mapProduct));
      if (custRes.data) setCustomers(custRes.data.map(mapCustomer));

      if (ordRes.data) {
        const freshOrders = ordRes.data.map(mapOrder);
        if (orders.length > 0 && freshOrders.length > orders.length) {
          if (soundEnabled) {
            playNewOrderAlert();
          }
        }
        setOrders(freshOrders);
      }

      if (convRes.data) {
        setConversations(convRes.data.map(mapConversation));
      }

      if (opRes.data) {
        setOperators(opRes.data.map(mapOperator));
      }
    } catch (err) {
      console.error("Erro fatal ao sincronizar estados do Supabase:", err);
    } finally {
      setWorkspaceLoading(false);
    }
  };

  useEffect(() => {
    if (!authReady || !user) return;
    loadAllData();

    // Supabase Realtime subscriptions
    // IMPORTANT: dependency array must NOT include orders/conversations state — doing so
    // destroys and recreates channels on every loadAllData(), causing missed events.
    const pedidosSub = supabase.channel('pedidos_rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos' }, payload => {
        if (payload.eventType === 'INSERT') {
          if (soundEnabledRef.current) playNewOrderAlert();
          // PRD 4.1 — Push notification quando painel está em background
          const newOrder: any = payload.new;
          const valor = Number(newOrder?.valor_total || 0).toFixed(2);
          const numero = newOrder?.numero_pedido || '';
          notify({
            title: '🍕 Novo pedido!',
            body: `Pedido #${numero} • R$ ${valor}`,
            tag: `order-${newOrder?.id}`
          });
        }
        loadAllData();
      })
      .subscribe();

    const conversasSub = supabase.channel('conversas_rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversas' }, (payload: any) => {
        // Alerta quando conversa requer humano
        if (payload?.new?.status === 'Humano necessário' && payload?.old?.status !== 'Humano necessário') {
          notify({
            title: '⚠️ Atendimento humano necessário',
            body: `Cliente ${payload.new.cliente_nome || payload.new.cliente_telefone} solicitou atendente.`,
            tag: `humano-${payload.new.id}`
          });
        }
        loadAllData();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(pedidosSub);
      supabase.removeChannel(conversasSub);
    };
  }, [authReady, user?.id]); // Only re-subscribe when auth changes — NOT on data changes

  useEffect(() => {
    if (!authReady || !user || isPlatformAdmin || !pizzeria?.id) return;

    const refresh = () => {
      loadAllData();
    };

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        refresh();
      }
    };

    const interval = window.setInterval(refresh, 5000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [authReady, user?.id, isPlatformAdmin, pizzeria?.id]);

  useEffect(() => {
    if (currentOperator && currentOperator.role !== 'Admin' && (activeTab === 'financeiro' || activeTab === 'config' || activeTab === 'quickstart')) {
      setActiveTab('dashboard');
    }
  }, [activeTab, currentOperator]);

  // Map camelCase Pizzeria fields → snake_case DB columns
  const pizzeriaToDb = (fields: Partial<Pizzeria>): Record<string, unknown> => {
    const map: Record<string, string> = {
      name: 'nome', address: 'endereco', logoUrl: 'logo_url',
      phoneAdmin: 'telefone_admin', instance: 'instancia',
      plan: 'plano', botActiveGlobal: 'bot_ativo_global',
      promptPersonalized: 'prompt_personalizado', asaasApiKey: 'asaas_api_key',
      mpAccessToken: 'mp_access_token', gatewayPayment: 'gateway_pagamento', hoursOfOperation: 'horario_funcionamento',
      messageDelivered: 'mensagem_entregue', statusMessages: 'mensagens_status',
      columnNames: 'nomes_colunas'
    };
    return Object.fromEntries(
      Object.entries(fields).map(([k, v]) => [map[k] ?? k, v])
    );
  };

  const productToDb = (fields: Partial<Product>): Record<string, unknown> => {
    const map: Record<string, string> = {
      pizzeriaId: 'pizzaria_id',
      category: 'categoria',
      name: 'nome',
      description: 'descricao',
      price: 'preco',
      available: 'disponivel',
      imageUrl: 'imagem_url',
      order: 'ordem'
    };
    return Object.fromEntries(
      Object.entries(fields).map(([k, v]) => [map[k] ?? k, v])
    );
  };

  const notifyStatusWebhook = async (orderId: string, status: OrderStatus) => {
    const webhookUrl = import.meta.env.VITE_N8N_STATUS_WEBHOOK_URL;
    const ragWebhookUrl = import.meta.env.VITE_N8N_RAG_WEBHOOK_URL;
    if (!pizzeria) return;

    const order = orders.find(o => o.id === orderId);
    if (!order) return;

    const messageByStatus = {
      ...pizzeria.statusMessages,
      entregue: pizzeria.statusMessages?.entregue || pizzeria.messageDelivered
    };

    // 1) Status notification (Kanban → WhatsApp)
    if (webhookUrl) {
      try {
        await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event: 'order_status_changed',
            pizzeriaId: pizzeria.id,
            instance: pizzeria.instance,
            orderId,
            orderNumber: order.orderNumber,
            customerPhone: order.customerPhone,
            customerName: order.customerName,
            status,
            message: messageByStatus[status] || '',
            paymentStatus: order.paymentStatus
          })
        });
      } catch (err) {
        console.error("Erro ao notificar webhook n8n status:", err);
      }
    }

    // 2) RAG update + mensagem de agradecimento quando o pedido é marcado como entregue
    if (status === 'entregue') {
      const payload = JSON.stringify({ pedido_id: orderId, pizzaria_id: pizzeria.id });

      if (ragWebhookUrl) {
        try {
          await fetch(ragWebhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload
          });
        } catch (err) {
          console.error("Erro ao notificar webhook RAG:", err);
        }
      }

      // PRD 5.4 #8 — Mensagem de Agradecimento (subworkflow dedicado)
      const thanksUrl = import.meta.env.VITE_N8N_THANKS_WEBHOOK_URL;
      if (thanksUrl) {
        try {
          await fetch(thanksUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload
          });
        } catch (err) {
          console.error("Erro ao notificar webhook agradecimento:", err);
        }
      }
    }
  };

  const sendWhatsAppText = async (phone: string, text: string) => {
    const evolutionUrl = (import.meta.env.VITE_EVOLUTION_API_URL as string | undefined)?.replace(/\/$/, "");
    const evolutionKey = import.meta.env.VITE_EVOLUTION_API_KEY as string | undefined;
    const instance = pizzeria?.instance;

    // Validate env vars
    if (!evolutionUrl || !evolutionKey) {
      throw new Error("Evolution API não configurada (VITE_EVOLUTION_API_URL / VITE_EVOLUTION_API_KEY ausentes no .env).");
    }

    // Validate instance: must be a non-empty string that is not the literal "undefined" or "null"
    // (these happen when a JS undefined value was accidentally serialised to the DB)
    if (!instance || instance === 'undefined' || instance === 'null') {
      throw new Error(
        `Instância WhatsApp não configurada (valor: "${instance ?? 'vazio'}"). ` +
        `Defina o campo Instância em Configurações → Perfil Comercial.`
      );
    }

    const res = await fetch(`${evolutionUrl}/message/sendText/${instance}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: evolutionKey },
      body: JSON.stringify({ number: phone.replace(/\D/g, ''), text })
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      // Evolution API nests the message in different shapes across versions
      const detail =
        body?.response?.message?.[0] ??
        body?.message ??
        body?.error ??
        `HTTP ${res.status}`;
      throw new Error(`Evolution API ${res.status}: ${detail}`);
    }
  };

  // Supabase update operations
  const updatePizzeria = async (fields: Partial<Pizzeria>) => {
    if (!pizzeria?.id) return;
    const dbFields = pizzeriaToDb(fields);
    const { error } = await supabase.from('pizzarias').update(dbFields).eq('id', pizzeria.id);
    if (error) {
      console.error('updatePizzeria error:', error);
      throw new Error(error.message || 'Erro ao salvar configurações no banco de dados.');
    }
    await loadAllData();
  };

  const createProduct = async (fields: Omit<Product, 'id' | 'pizzeriaId' | 'order'>) => {
    if (!pizzeria?.id) return;
    try {
      await supabase.from('produtos').insert([{ ...productToDb(fields), pizzaria_id: pizzeria.id }]);
      await loadAllData();
    } catch (err) {
      console.error(err);
    }
  };

  const updateProduct = async (id: string, fields: Partial<Product>) => {
    if (!pizzeria?.id) return;
    try {
      await supabase.from('produtos').update(productToDb(fields)).eq('id', id).eq('pizzaria_id', pizzeria.id);
      await loadAllData();
    } catch (err) {
      console.error(err);
    }
  };

  const deleteProduct = async (id: string) => {
    if (!pizzeria?.id) return;
    try {
      await supabase.from('produtos').delete().eq('id', id).eq('pizzaria_id', pizzeria.id);
      await loadAllData();
    } catch (err) {
      console.error(err);
    }
  };

  const updateOrderStatus = async (id: string, newStatus: OrderStatus, paymentStatus?: 'pending' | 'approved' | 'cancelled') => {
    if (!pizzeria?.id) return;
    try {
      const payload: Record<string, unknown> = { status: newStatus };
      if (paymentStatus) payload.payment_status = paymentStatus;
      await supabase.from('pedidos').update(payload).eq('id', id).eq('pizzaria_id', pizzeria.id);
      await notifyStatusWebhook(id, newStatus);
      await loadAllData();
    } catch (err) {
      console.error(err);
    }
  };

  const updateOrderDetails = async (id: string, updatedFields: Partial<Order>) => {
    if (!pizzeria?.id) return;
    try {
      // Map TypeScript Order fields → DB snake_case columns
      const dbFields: Record<string, unknown> = {};
      if (updatedFields.deliveryAddress !== undefined) dbFields.endereco_entrega = updatedFields.deliveryAddress;
      if (updatedFields.notes !== undefined) dbFields.observacoes = updatedFields.notes;
      if (updatedFields.paymentStatus !== undefined) dbFields.payment_status = updatedFields.paymentStatus;
      if (updatedFields.paymentId !== undefined) dbFields.payment_id = updatedFields.paymentId;
      if (updatedFields.paymentLink !== undefined) dbFields.link_pagamento = updatedFields.paymentLink;
      if (updatedFields.status !== undefined) dbFields.status = updatedFields.status;
      if (updatedFields.items !== undefined) dbFields.itens = updatedFields.items;
      if (updatedFields.totalValue !== undefined) dbFields.valor_total = updatedFields.totalValue;
      await supabase.from('pedidos').update(dbFields).eq('id', id).eq('pizzaria_id', pizzeria.id);
      await loadAllData();
    } catch (err) {
      console.error(err);
    }
  };

  const cancelOrder = async (id: string) => {
    if (!pizzeria?.id) return;
    try {
      await supabase.from('pedidos').update({ status: 'cancelado' }).eq('id', id).eq('pizzaria_id', pizzeria.id);
      await notifyStatusWebhook(id, 'cancelado');
      await loadAllData();
    } catch (err) {
      console.error(err);
    }
  };

  const generatePaymentLink = async (orderId: string) => {
    if (!pizzeria?.id) return;
    const webhookUrl = import.meta.env.VITE_N8N_PAYMENT_WEBHOOK_URL;
    if (!webhookUrl) {
      alert("Configure VITE_N8N_PAYMENT_WEBHOOK_URL no .env para gerar links de pagamento.");
      return;
    }

    const order = orders.find(o => o.id === orderId);
    if (!order) return;

    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'generate_payment',
          pizzeriaId: pizzeria.id,
          pizzeriaName: pizzeria.name,
          gateway: pizzeria.gatewayPayment,
          instance: pizzeria.instance,
          orderId: order.id,
          orderNumber: order.orderNumber,
          customerId: order.customerId,
          customerName: order.customerName,
          customerPhone: order.customerPhone,
          totalValue: order.totalValue,
          paymentMethod: order.paymentMethod,
          items: order.items
        })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || data?.message || `HTTP ${res.status}`);
      }

      await updateOrderDetails(orderId, {
        paymentId: data.paymentId || data.payment_id || data.id,
        paymentLink: data.paymentLink || data.link_pagamento || data.invoiceUrl || data.bankSlipUrl,
        paymentStatus: data.paymentStatus || 'pending'
      });
    } catch (err: any) {
      console.error("Erro ao gerar pagamento:", err);
      alert(`Não foi possível gerar o link de pagamento: ${err.message || "erro desconhecido"}`);
    }
  };

  const sendHumanMessage = async (phone: string, content: string) => {
    const conv = conversations.find(c => c.customerPhone === phone);
    if (!conv) return;

    const newMessage = { id: "m-" + Date.now(), sender: "human", content, timestamp: new Date().toISOString() };
    const updatedMessages = [...conv.messages, newMessage];

    // 1) Persist to DB first — message history is preserved regardless of WhatsApp status
    try {
      await supabase.from('conversas').update({
        messages: updatedMessages,
        last_message: content,
        last_timestamp: new Date().toISOString(),
        bot_ativo: false,
        status: 'Humano necessário'
      }).eq('id', conv.id).eq('pizzaria_id', conv.pizzeriaId);
    } catch (dbErr: any) {
      console.error("Erro ao salvar mensagem no banco:", dbErr);
      alert(`Não foi possível salvar a mensagem: ${dbErr?.message ?? 'Erro desconhecido.'}`);
      return;
    }

    // 2) Send via WhatsApp — show clear error if it fails (message is already saved above)
    try {
      await sendWhatsAppText(conv.customerPhone, content);
    } catch (waErr: any) {
      console.error("Erro ao enviar via WhatsApp:", waErr);
      alert(
        `⚠️ Mensagem salva no sistema, mas não foi entregue via WhatsApp.\n\n` +
        `Detalhe: ${waErr?.message ?? 'Erro desconhecido.'}\n\n` +
        `Verifique se a instância Evolution está conectada em Configurações.`
      );
    }

    await loadAllData();
  };

  const toggleBot = async (phone: string, botActive: boolean) => {
    const conv = conversations.find(c => c.customerPhone === phone);
    if (!conv) return;
    try {
      await supabase.from('conversas').update({ 
        bot_ativo: botActive,
        status: botActive ? 'Bot ativo' : 'Humano necessário'
      }).eq('id', conv.id).eq('pizzaria_id', conv.pizzeriaId);
      await loadAllData();
    } catch (err) {
      console.error(err);
    }
  };

  const inviteOperator = async (email: string, role: Operator['role']) => {
    if (!pizzeria?.id) return;
    try {
      await supabase.from('equipe_pizzaria').insert([{
        pizzaria_id: pizzeria.id,
        email,
        role,
        status: 'Pendente'
      }]);
      await loadAllData();
    } catch (err) {
      console.error(err);
    }
  };

  const deleteOperator = async (id: string) => {
    if (!pizzeria?.id) return;
    try {
      await supabase.from('equipe_pizzaria')
        .delete()
        .eq('id', id)
        .eq('pizzaria_id', pizzeria.id);
      await loadAllData();
    } catch (err) {
      console.error(err);
    }
  };

  // Submit manual order from operator modal (Section 4.1)
  const handleLaunchManualOrderSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomerId) {
      alert("Por favor, selecione um cliente cadastrado.");
      return;
    }

    const customer = customers.find(c => c.id === selectedCustomerId);
    if (!customer) return;

    // Compile items fromSelections
    const compiledItems: OrderItem[] = [];
    let calculatedTotal = 0;
    
    Object.entries(orderItemSelections).forEach(([prodId, qtyVal]) => {
      const qty = Number(qtyVal);
      if (qty > 0) {
        const product = products.find(p => p.id === prodId);
        if (product) {
          compiledItems.push({
            name: product.name,
            qty,
            priceUnit: product.price
          });
          calculatedTotal += product.price * qty;
        }
      }
    });

    if (compiledItems.length === 0) {
      alert("Por favor, selecione ao menos 1 item do cardápio.");
      return;
    }

    try {
      if (!pizzeria?.id) return;
      
      const payload = {
        pizzaria_id: pizzeria.id,
        cliente_id: customer.id,
        itens: compiledItems,
        valor_total: calculatedTotal,
        status: "novo",
        tipo: manualDeliveryType,
        endereco_entrega: manualDeliveryType === "delivery" ? manualAddress : "Retirada Balcão",
        forma_pagamento: manualPaymentMethod,
        payment_status: manualPaymentStatus,
        observacoes: manualNotes,
        bot_ativo: false // Manually added order shuts off bot for safety
      };

      const res = await supabase.from('pedidos').insert([payload]);

      if (!res.error) {
        // Toggle sound if configured
        if (soundEnabled) playNewOrderAlert();
        
        setIsManualOrderModalOpen(false);
        setSelectedCustomerId("");
        setManualAddress("");
        setManualNotes("");
        setOrderItemSelections({});
        await loadAllData();
        setActiveTab("kanban"); // Jump to operational view
      } else {
        console.error(res.error);
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Sync manual modal delivery address if client selected
  const handleSelectCustomerForManualOrder = (id: string) => {
    setSelectedCustomerId(id);
    const customer = customers.find(c => c.id === id);
    if (customer) {
      setManualAddress(customer.defaultAddress || "");
    }
  };

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError(null);

    const result = authMode === 'login'
      ? await supabase.auth.signInWithPassword({ email: authEmail.trim(), password: authPassword })
      : await supabase.auth.signUp({ email: authEmail.trim(), password: authPassword });

    setAuthLoading(false);
    if (result.error) {
      setAuthError(result.error.message);
      return;
    }

    if (authMode === 'signup' && !result.data.session) {
      setAuthError("Conta criada. Verifique seu e-mail para confirmar o acesso antes de entrar.");
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setPizzeria(null);
    setProducts([]);
    setCustomers([]);
    setOrders([]);
    setConversations([]);
    setOperators([]);
    setCurrentOperator(null);
    setIsPlatformAdmin(false);
    setWorkspaceLoading(false);
  };

  // Urgent human intervention flashing beacon in top bar
  const urgentInterventionsCount = conversations.filter(c => c.status === "Humano necessário").length;
  const isAdmin = currentOperator?.role === 'Admin';

  if (!authReady) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 font-sans">
        <div className="text-center text-slate-300">
          <Pizza className="w-12 h-12 text-orange-500 mx-auto mb-4 animate-pulse" />
          <p className="text-sm font-semibold">Carregando sessão...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 font-sans">
        <form onSubmit={handleAuthSubmit} className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden">
          <div className="px-6 py-5 bg-slate-900 text-white flex items-center gap-3">
            <div className="p-2 bg-orange-600 rounded-xl">
              <Pizza className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-lg font-bold">PizzaBot Workspace</h1>
              <p className="text-xs text-slate-400">Acesse sua pizzaria para operar o atendimento.</p>
            </div>
          </div>

          <div className="p-6 space-y-4">
            <div className="inline-flex p-1 bg-slate-100 rounded-lg">
              <button
                type="button"
                onClick={() => setAuthMode('login')}
                className={`px-3 py-1.5 text-xs font-bold rounded-md ${authMode === 'login' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
              >
                Entrar
              </button>
              <button
                type="button"
                onClick={() => setAuthMode('signup')}
                className={`px-3 py-1.5 text-xs font-bold rounded-md ${authMode === 'signup' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
              >
                Criar acesso
              </button>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">E-mail</label>
              <input
                type="email"
                required
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-hidden focus:border-orange-500"
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">Senha</label>
              <input
                type="password"
                required
                minLength={6}
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-hidden focus:border-orange-500"
              />
            </div>

            {authError && (
              <div className="p-3 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg">
                {authError}
              </div>
            )}

            <button
              type="submit"
              disabled={authLoading}
              className="w-full px-4 py-2.5 text-sm font-bold text-white bg-orange-600 hover:bg-orange-700 disabled:opacity-60 rounded-lg"
            >
              {authLoading ? "Processando..." : authMode === 'login' ? "Entrar no Painel" : "Criar acesso"}
            </button>
          </div>
        </form>
      </div>
    );
  }

  // Platform admin check MUST come before the workspaceLoading gate.
  // For admins, pizzeria is always null — so workspaceLoading && !pizzeria would
  // trap them in the loading spinner every time workspaceLoading flicks to true
  // (e.g. on any auth event or Realtime DB change). Once isPlatformAdmin is known,
  // skip straight to the admin panel regardless of workspaceLoading state.
  if (isPlatformAdmin) {
    return (
      <SaasAdminView
        userEmail={user.email || ""}
        onSignOut={handleSignOut}
      />
    );
  }

  if (workspaceLoading && !pizzeria) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 font-sans">
        <div className="text-center text-slate-300">
          <Pizza className="w-12 h-12 text-orange-500 mx-auto mb-4 animate-pulse" />
          <p className="text-sm font-semibold">Carregando workspace...</p>
        </div>
      </div>
    );
  }

  if (!pizzeria) {
    // PRD seção 8 Fase 4 — Onboarding completo com criação da instância Evolution
    return (
      <OnboardingWizard
        userEmail={user.email || ""}
        onComplete={() => loadAllData()}
        onSignOut={handleSignOut}
      />
    );
  }

  return (
    <div className="h-screen bg-[#fafbfc] flex flex-col font-sans select-none overflow-hidden">
      
      {/* App Header */}
      <header className="px-6 py-4 bg-slate-900 text-white flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="p-2.5 bg-orange-600 rounded-xl flex items-center justify-center">
            <Pizza className="w-6 h-6 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-1.5 leading-none">
              <span className="text-lg font-bold tracking-tight text-white font-sans">PizzaBot</span>
              <span className="p-0.5 px-2 bg-orange-500/20 text-[9px] uppercase font-bold tracking-widest text-orange-400 rounded-md font-mono">WORKSPACE</span>
            </div>
            <p className="text-[10px] text-slate-400 font-sans mt-0.5">
              Atendimento Inteligente integrado ao WhatsApp • {pizzeria?.name || "Lanchonete"}
            </p>
          </div>
        </div>

        {/* Live operational logs beacon */}
        <div className="flex items-center gap-4">
          
          {/* Audio toggle controls */}
          <button
            type="button"
            onClick={() => setSoundEnabled(!soundEnabled)}
            className={`p-1.5 px-2.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition-all ${
              soundEnabled ? "bg-emerald-600/10 text-emerald-400 border-emerald-500/20" : "bg-slate-800 text-slate-400 border-slate-700"
            }`}
          >
            <Volume2 className="w-4 h-4" />
            <span>Alerta Sonoro: {soundEnabled ? "Ligado" : "Mudo"}</span>
          </button>

          {/* Push Notifications toggle (PRD 4.1) */}
          {notifPermission !== "granted" && notifPermission !== "denied" && (
            <button
              type="button"
              onClick={handleEnableNotifications}
              className="p-1.5 px-2.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition-all bg-orange-600/10 text-orange-300 border-orange-500/20 hover:bg-orange-600/20"
              title="Ativar notificações do navegador"
            >
              <AlertCircle className="w-4 h-4" />
              <span>Ativar Notificações</span>
            </button>
          )}
          {notifPermission === "granted" && (
            <span className="p-1.5 px-2.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 bg-emerald-600/10 text-emerald-400 border-emerald-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Notificações Ativas
            </span>
          )}

          {urgentInterventionsCount > 0 && (
            <div className="p-1 px-3 bg-rose-500/20 text-rose-300 border border-rose-500/20 animate-pulse text-xs font-bold font-mono uppercase rounded-lg flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4" />
              <span>{urgentInterventionsCount} Humano Necessário!</span>
            </div>
          )}

          <div className="text-right hidden md:block select-none">
            <span className="text-[11px] font-bold text-slate-400 font-mono block">DASHBOARD CENTRAL</span>
            <span className="text-[10px] text-emerald-400 font-mono font-medium flex items-center justify-end gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
              Sincronizado Supabase Realtime
            </span>
          </div>

          <button
            type="button"
            onClick={handleSignOut}
            className="p-1.5 px-2.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition-all bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700"
            title={user.email || "Sair"}
          >
            <LogOut className="w-4 h-4" />
            <span>Sair</span>
          </button>
        </div>
      </header>

      {/* Main Grid Viewport - Dashboard Workspace (Left) + WhatsApp Simulator (Right) */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        
        {/* Sidebar & Central Workspace Container (8 cols) */}
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          
          {/* Responsive Layout Sidebar */}
          <nav className="w-full md:w-56 bg-slate-50 border-r border-slate-200 p-3.5 space-y-1.5 md:flex md:flex-col shrink-0 overflow-y-auto">
            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest font-mono p-1 block">Módulos do Sistema</span>
            <button
              onClick={() => setActiveTab("quickstart")}
              disabled={!isAdmin}
              className={`w-full p-2.5 px-3.5 text-xs font-semibold rounded-lg text-left flex items-center gap-2.5 transition-all font-sans ${
                activeTab === "quickstart"
                  ? "bg-orange-600 text-white font-bold"
                  : isAdmin ? "text-slate-600 hover:text-slate-800 hover:bg-orange-50" : "text-slate-300 cursor-not-allowed"
              }`}
              title={isAdmin ? "Configuração rápida" : "Disponível apenas para Admin"}
            >
              <Sparkles className="w-4 h-4" />
              Configuração Rápida
            </button>
            <button
              onClick={() => setActiveTab("dashboard")}
              className={`w-full p-2.5 px-3.5 text-xs font-semibold rounded-lg text-left flex items-center gap-2.5 transition-all font-sans ${
                activeTab === "dashboard"
                  ? "bg-slate-800 text-white font-bold"
                  : "text-slate-600 hover:text-slate-800 hover:bg-slate-100/50"
              }`}
            >
              <LayoutDashboard className="w-4 h-4" />
              Visão Geral
            </button>
            <button
              onClick={() => setActiveTab("kanban")}
              className={`w-full p-2.5 px-3.5 text-xs font-semibold rounded-lg text-left flex items-center gap-2.5 transition-all font-sans ${
                activeTab === "kanban"
                  ? "bg-slate-800 text-white font-bold"
                  : "text-slate-600 hover:text-slate-800 hover:bg-slate-100/50"
              }`}
            >
              <ShoppingBag className="w-4 h-4" />
              Kanban de Pedidos
              <span className="p-0.5 px-1.5 text-[9px] bg-indigo-100 text-indigo-700 rounded-full ml-auto font-mono">
                {orders.filter(o => o.status !== "entregue" && o.status !== "cancelado").length}
              </span>
            </button>
            <button
              onClick={() => setActiveTab("conversas")}
              className={`w-full p-2.5 px-3.5 text-xs font-semibold rounded-lg text-left flex items-center gap-2.5 transition-all font-sans ${
                activeTab === "conversas"
                  ? "bg-slate-800 text-white font-bold"
                  : "text-slate-600 hover:text-slate-800 hover:bg-slate-100/50"
              }`}
            >
              <MessageSquare className="w-4 h-4" />
              Central Chat
              <span className="p-0.5 px-1.5 text-[9px] bg-amber-100 text-amber-700 rounded-full ml-auto font-mono">
                {conversations.length}
              </span>
            </button>
            <button
              onClick={() => setActiveTab("cardapio")}
              className={`w-full p-2.5 px-3.5 text-xs font-semibold rounded-lg text-left flex items-center gap-2.5 transition-all font-sans ${
                activeTab === "cardapio"
                  ? "bg-slate-800 text-white font-bold"
                  : "text-slate-600 hover:text-slate-800 hover:bg-slate-100/50"
              }`}
            >
              <UtensilsCrossed className="w-4 h-4" />
              Gerir Cardápio
            </button>
            <button
              onClick={() => setActiveTab("financeiro")}
              disabled={!isAdmin}
              className={`w-full p-2.5 px-3.5 text-xs font-semibold rounded-lg text-left flex items-center gap-2.5 transition-all font-sans ${
                activeTab === "financeiro"
                  ? "bg-slate-800 text-white font-bold"
                  : isAdmin ? "text-slate-600 hover:text-slate-800 hover:bg-slate-100/50" : "text-slate-300 cursor-not-allowed"
              }`}
              title={isAdmin ? "Financeiro" : "Disponível apenas para Admin"}
            >
              <DollarSign className="w-4 h-4" />
              Financeiro
            </button>
            <button
              onClick={() => setActiveTab("config")}
              disabled={!isAdmin}
              className={`w-full p-2.5 px-3.5 text-xs font-semibold rounded-lg text-left flex items-center gap-2.5 transition-all font-sans ${
                activeTab === "config"
                  ? "bg-slate-800 text-white font-bold"
                  : isAdmin ? "text-slate-600 hover:text-slate-800 hover:bg-slate-100/50" : "text-slate-300 cursor-not-allowed"
              }`}
              title={isAdmin ? "Configurações" : "Disponível apenas para Admin"}
            >
              <Settings className="w-4 h-4" />
              Configurações
            </button>

            {/* Operator & pizzeria info */}
            <div className="mt-auto pt-4 border-t border-slate-200/60 space-y-2">
              {/* Bot global toggle */}
              <button
                type="button"
                title={pizzeria?.botActiveGlobal ? "Bot global ativo — clique para pausar" : "Bot global pausado — clique para ativar"}
                onClick={() => updatePizzeria({ botActiveGlobal: !pizzeria?.botActiveGlobal })}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition-all font-sans ${
                  pizzeria?.botActiveGlobal
                    ? "bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100"
                    : "bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100"
                }`}
              >
                <Bot className="w-3.5 h-3.5 shrink-0" />
                <span>{pizzeria?.botActiveGlobal ? "Bot Global: Ativo" : "Bot Global: Pausado"}</span>
              </button>

              {/* Plan badge */}
              <div className="px-3 py-2 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-between">
                <span className="text-[10px] text-slate-500 font-sans">Plano</span>
                <span className="text-[10px] font-bold uppercase font-mono text-slate-700">
                  {pizzeria?.plan || "—"}
                </span>
              </div>

              {/* Operator role + test agent shortcut */}
              <div className="px-3 py-2 rounded-lg bg-slate-100 border border-slate-200 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-500 font-sans">Operador</span>
                  <span className="text-[10px] font-bold font-mono text-slate-700">
                    {currentOperator?.role || "—"}
                  </span>
                </div>
                <p className="text-[9px] text-slate-400 font-sans truncate" title={currentOperator?.email}>
                  {currentOperator?.email || user?.email || "—"}
                </p>
              </div>

              {isAdmin && (
                <button
                  type="button"
                  onClick={() => setIsTestAgentOpen(true)}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold text-orange-700 bg-orange-50 border border-orange-200 hover:bg-orange-100 transition-all font-sans"
                >
                  <Sparkles className="w-3.5 h-3.5 shrink-0" />
                  Testar Agente IA
                </button>
              )}
            </div>
          </nav>

          {/* Scrolling Workspace viewport screen */}
          <main className="flex-1 relative overflow-hidden flex flex-col min-h-0">
            <div className="flex-1 overflow-auto bg-[#f4f6f8] p-6">
              {!pizzeria ? (
                <div className="flex items-center justify-center h-full p-8">
                  <div className="bg-white p-8 rounded-2xl max-w-md w-full text-center border border-slate-200 shadow-lg">
                    <Pizza className="w-16 h-16 text-orange-500 mx-auto mb-4 animate-pulse" />
                    <h2 className="text-xl font-bold text-slate-900 mb-2">Conectado ao Supabase!</h2>
                    <p className="text-slate-500 mb-4">
                      O banco de dados respondeu, mas seu usuário ainda não está vinculado a uma pizzaria.
                    </p>
                    <div className="bg-slate-50 p-4 rounded-lg text-left text-sm text-emerald-700 border border-slate-200">
                      Execute o <strong>insert_mock_data.sql</strong> e entre com um e-mail cadastrado em <strong>equipe_pizzaria</strong>, ou convide este e-mail pela equipe de uma pizzaria existente.
                    </div>
                  </div>
                </div>
              ) : (
                <AnimatePresence mode="wait">
                  <motion.div
                    key={activeTab}
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -15 }}
                    transition={{ duration: 0.25, ease: "easeInOut" }}
                    className="w-full shrink-0 lg:shrink flex-1 flex flex-col min-h-0 min-w-0"
                  >
                  {activeTab === "quickstart" && pizzeria && isAdmin && (
                    <QuickSetupView
                      pizzeria={pizzeria}
                      products={products}
                      onUpdatePizzeria={updatePizzeria}
                      onCreateProduct={createProduct}
                      onOpenTestAgent={() => setIsTestAgentOpen(true)}
                    />
                  )}

                  {activeTab === "dashboard" && pizzeria && (
                    <DashboardView
                      orders={orders}
                      products={products}
                      customers={customers}
                      onNavigate={setActiveTab}
                      onOpenNewOrderModal={() => setIsManualOrderModalOpen(true)}
                    />
                  )}

                  {activeTab === "kanban" && (
                    <KanbanView
                      orders={orders}
                      onUpdateOrderStatus={updateOrderStatus}
                      onUpdateOrderDetails={updateOrderDetails}
                      onGeneratePaymentLink={generatePaymentLink}
                      onCancelOrder={cancelOrder}
                      columnNames={columnNames}
                      onOpenNewOrderModal={() => setIsManualOrderModalOpen(true)}
                    />
                  )}

                  {activeTab === "conversas" && (
                    <ConversationsView
                      conversations={conversations}
                      activeConvPhone={activeConvPhone}
                      onSelectConversation={setActiveConvPhone}
                      onSendHumanMessage={sendHumanMessage}
                      onToggleBot={toggleBot}
                      customers={customers}
                      orders={orders}
                    />
                  )}

                  {activeTab === "cardapio" && (
                    <MenuManagementView
                      products={products}
                      onCreateProduct={createProduct}
                      onUpdateProduct={updateProduct}
                      onDeleteProduct={deleteProduct}
                    />
                  )}

                  {activeTab === "financeiro" && isAdmin && (
                    <FinancialView
                      orders={orders}
                    />
                  )}

                  {activeTab === "config" && pizzeria && isAdmin && (
                    <SettingsView
                      pizzeria={pizzeria}
                      operators={operators}
                      onUpdatePizzeria={updatePizzeria}
                      onInviteOperator={inviteOperator}
                      onDeleteOperator={deleteOperator}
                      onOpenTestAgent={() => setIsTestAgentOpen(true)}
                    />
                  )}
                </motion.div>
              </AnimatePresence>
              )}
            </div>
          </main>

        </div>

        {/* Client Smartphone Simulator (Right Workspace panel - 4 cols width on high screen) */}
        <aside className="w-full lg:w-[380px] shrink-0 border-t lg:border-t-0 lg:border-l border-slate-200 p-4 bg-slate-50 flex flex-col overflow-hidden h-[450px] lg:h-auto">
          <ClientSimulator
            conversations={conversations}
            activeConvPhone={activeConvPhone}
            onRefreshAllData={loadAllData}
            onSelectConversation={(phone) => {
              setActiveConvPhone(phone);
              // Jump to chat tab
              setActiveTab("conversas");
            }}
          />
        </aside>

      </div>

      {/* Launcher Manual Order Modal Container */}
      {isManualOrderModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col border border-slate-100">
            {/* Header */}
            <div className="px-5 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <div>
                <span className="text-[10px] uppercase font-bold text-orange-600 font-mono">Painel de Operação Manual</span>
                <h3 className="text-sm font-bold text-slate-850 font-sans">Lançar Novo Pedido</h3>
              </div>
              <button 
                onClick={() => setIsManualOrderModalOpen(false)}
                className="p-1 hover:bg-slate-200 rounded"
              >
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleLaunchManualOrderSubmit} className="p-5 space-y-4 overflow-y-auto max-h-[480px]">
              
              {/* Select Client customer */}
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide font-sans mb-1">Escolha o Cliente (Banco de Dados)</label>
                <select
                  required
                  value={selectedCustomerId}
                  onChange={(e) => handleSelectCustomerForManualOrder(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg text-slate-700 outline-hidden font-sans"
                >
                  <option value="">-- Selecionar Cliente --</option>
                  {customers.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.phone})
                    </option>
                  ))}
                </select>
              </div>

              {/* Items selectors with quantities picker (Section 4.1) */}
              <div className="space-y-2">
                <span className="text-[10px] font-bold text-slate-500 tracking-wider block font-sans">SELECIONE OS ITENS DO CARDÁPIO</span>
                <div className="border border-slate-150 rounded-lg max-h-[160px] overflow-y-auto divide-y divide-slate-100 p-2 bg-slate-50/50">
                  {products.map(p => {
                    const activeQty = orderItemSelections[p.id] || 0;
                    return (
                      <div key={p.id} className="py-2 flex items-center justify-between text-xs font-sans">
                        <div className="space-y-0.5">
                          <p className="font-semibold text-slate-800">{p.name} {!p.available && <span className="text-[9px] text-red-500 font-bold">(Indisponível)</span>}</p>
                          <p className="text-[10px] text-slate-500 font-mono">R$ {p.price.toFixed(2)}</p>
                        </div>
                        
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setOrderItemSelections({
                              ...orderItemSelections,
                              [p.id]: Math.max(0, activeQty - 1)
                            })}
                            className="w-6 h-6 border rounded flex items-center justify-center font-bold bg-white text-slate-500"
                          >
                            -
                          </button>
                          <span className="w-8 text-center font-bold font-mono">{activeQty}</span>
                          <button
                            type="button"
                            onClick={() => setOrderItemSelections({
                              ...orderItemSelections,
                              [p.id]: activeQty + 1
                            })}
                            className="w-6 h-6 border rounded flex items-center justify-center font-bold bg-white text-slate-500"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Delivery and logistics information */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide font-sans mb-1">Tipo de Entrega</label>
                  <select
                    value={manualDeliveryType}
                    onChange={(e: any) => setManualDeliveryType(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:border-orange-500 focus:outline-hidden text-slate-700 font-sans"
                  >
                    <option value="delivery">Delivery 🏍️</option>
                    <option value="retirada">Retirada Balcão 🚶</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide font-sans mb-1">Método Pagamento</label>
                  <select
                    value={manualPaymentMethod}
                    onChange={(e: any) => setManualPaymentMethod(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:border-orange-500 focus:outline-hidden text-slate-700 font-sans"
                  >
                    <option value="pix">PIX copia-e-cola</option>
                    <option value="cartao">Cartão de Crédito</option>
                    <option value="dinheiro">Dinheiro vivo</option>
                  </select>
                </div>

                {manualDeliveryType === "delivery" && (
                  <div className="col-span-2">
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide font-sans mb-1">Endereço de Entrega</label>
                    <input
                      type="text"
                      value={manualAddress}
                      onChange={(e) => setManualAddress(e.target.value)}
                      placeholder="Ex: Rua das Rosas, 450 - Centro"
                      className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:border-orange-500 focus:outline-hidden text-slate-800 font-sans"
                    />
                  </div>
                )}

                <div className="col-span-2">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide font-sans mb-1">Observações Operacionais</label>
                  <input
                    type="text"
                    value={manualNotes}
                    onChange={(e) => setManualNotes(e.target.value)}
                    placeholder="Sem cebola, troco para 100 etc..."
                    className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:border-orange-500 focus:outline-hidden text-slate-800 font-sans"
                  />
                </div>
              </div>

              {/* Submit triggers inside manual order modal */}
              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2.5 font-sans">
                <button
                  type="button"
                  onClick={() => setIsManualOrderModalOpen(false)}
                  className="px-4 py-2 text-xs text-slate-500 hover:text-slate-700 font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4.5 py-2 text-xs text-white bg-orange-600 hover:bg-orange-700 rounded-lg font-bold shadow-sm"
                >
                  Confirmar e Lançar Ticket
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

      {/* PRD 4.6 — Modal "Testar Agente" para simular conversa */}
      {pizzeria && (
        <TestAgentModal
          pizzeria={pizzeria}
          isOpen={isTestAgentOpen}
          onClose={() => setIsTestAgentOpen(false)}
        />
      )}

    </div>
  );
}
