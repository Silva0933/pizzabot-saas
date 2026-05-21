export interface Pizzeria {
  id: string;
  name: string;
  address?: string;
  logoUrl?: string;
  instance: string;
  phoneAdmin: string;
  plan: 'basico' | 'pro' | 'enterprise';
  botActiveGlobal: boolean;
  promptPersonalized: string;
  asaasApiKey: string;
  mpAccessToken: string;
  gatewayPayment: 'asaas' | 'mercadopago' | 'nenhum';
  hoursOfOperation: Record<string, string>; // e.g. { "seg-sex": "18:00 - 23:30", "sab-dom": "18:00 - 00:00" }
  messageDelivered: string;
  statusMessages: Record<string, string>;
  columnNames: Record<string, string>;
}

export interface Operator {
  id: string;
  pizzeriaId: string;
  userId?: string;
  email: string;
  role: 'Admin' | 'Atendente';
  status: 'Ativo' | 'Pendente' | 'Proprietário';
  createdAt: string;
}

export type ProductGroup = 'pizza' | 'lanche' | 'bebida' | 'sobremesa' | 'outro';

export interface Product {
  id: string;
  pizzeriaId: string;
  category: ProductGroup;
  name: string;
  description: string;
  price: number;
  available: boolean;
  imageUrl: string;
  order: number;
}

export interface Customer {
  id: string;
  pizzeriaId: string;
  phone: string;
  name: string;
  defaultAddress: string;
  preferences: string;
  orderHistory: CompactOrder[];
  totalOrders: number;
  totalSpent: number;
  lastVisit: string;
}

export interface CompactOrder {
  id: string;
  number: number;
  date: string;
  items: string; // e.g. "1x Pizza Calabresa, 1x Coca 2L"
  total: number;
}

export interface OrderItem {
  name: string;
  qty: number;
  priceUnit: number;
  observation?: string;
}

export type OrderStatus = 'novo' | 'confirmado' | 'no_forno' | 'a_caminho' | 'entregue' | 'cancelado';

export interface Order {
  id: string;
  pizzeriaId: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  orderNumber: number;
  items: OrderItem[];
  totalValue: number;
  status: OrderStatus;
  deliveryType: 'delivery' | 'retirada';
  deliveryAddress: string;
  paymentMethod: 'pix' | 'cartao' | 'dinheiro';
  paymentId?: string;
  paymentStatus: 'pending' | 'approved' | 'cancelled';
  paymentLink?: string;
  notes?: string;
  botActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  sender: 'client' | 'bot' | 'human';
  content: string;
  timestamp: string;
  audioUrl?: string;
}

export interface Conversation {
  id: string;
  pizzeriaId: string;
  customerName: string;
  customerPhone: string;
  lastMessage: string;
  lastTimestamp: string;
  botActive: boolean;
  status: 'Bot ativo' | 'Aguardando pagamento' | 'Humano necessário' | 'Encerrada';
  messages: Message[];
}
