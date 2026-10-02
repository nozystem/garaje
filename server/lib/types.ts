export interface StoredUser {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  createdAt: string;
}

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  isAdmin: boolean;
}

export interface StoredVehicle {
  id: string;
  userId: string;
  nickname: string;
  make: string;
  model: string;
  year: number;
  type: string;
  fuel: string;
  generation?: string;
  body?: string;
  transmission?: string;
  engine?: string;
  plate?: string;
  mileage: number;
  mileageUpdatedAt: string;
  monthlyMileage?: number;
  color?: string;
  photo?: string;
  illustration?: string;
  illustrationAt?: string;
  /** Ver ILLUSTRATION_VERSION en car-illustration.ts. */
  illustrationVersion?: number;
  notes?: string;
  /** No aparece en su perfil público (ver social.ts). */
  socialHidden?: boolean;
  createdAt: string;
}

export interface StoredRecord {
  id: string;
  userId: string;
  vehicleId: string;
  category: string;
  title: string;
  date: string;
  mileage: number;
  cost?: number;
  workshop?: string;
  notes?: string;
  /** Piezas cambiadas, con su referencia si se sabe. */
  parts?: string;
  /** Foto del ticket o la factura, como data URL. */
  photo?: string;
  planId?: string;
  /** Quien lo apuntó, si no es el dueño del coche (coches compartidos). */
  createdBy?: string;
  createdAt: string;
}

export interface StoredPlan {
  id: string;
  userId: string;
  vehicleId: string;
  category: string;
  title: string;
  intervalKm?: number;
  intervalMonths?: number;
  lastServiceMileage?: number;
  lastServiceDate?: string;
  active: boolean;
  notes?: string;
  createdAt: string;
}

export type DocumentKind = 'insurance' | 'inspection' | 'registration' | 'tax' | 'warranty' | 'other';

/** Seguro, ITV, permiso de circulación…: un papel del coche que caduca. */
export interface StoredDocument {
  id: string;
  userId: string;
  vehicleId: string;
  kind: DocumentKind;
  title: string;
  /** Número de póliza, de expediente… */
  number?: string;
  /** Aseguradora, estación de ITV… */
  provider?: string;
  expiresAt?: string;
  cost?: number;
  notes?: string;
  /** Foto del documento, como data URL. */
  photo?: string;
  createdAt: string;
}

/** Un repostaje (o una carga, en un eléctrico). */
export interface StoredFuel {
  id: string;
  userId: string;
  vehicleId: string;
  date: string;
  mileage: number;
  /** Litros, o kWh en un eléctrico. */
  liters: number;
  /** Lo pagado en total. */
  cost: number;
  /** Depósito lleno: solo entre dos llenos se puede calcular el consumo. */
  fullTank: boolean;
  station?: string;
  createdBy?: string;
  createdAt: string;
}

/** Un taller de confianza del usuario. */
export interface StoredWorkshop {
  id: string;
  userId: string;
  name: string;
  phone?: string;
  address?: string;
  notes?: string;
  createdAt: string;
}

export type MemberRole = 'owner' | 'member';

/** Lo que el cliente sabe de un coche que otro ha compartido con él. */
export interface SharedInfo {
  ownerName: string;
  ownerEmail: string;
}

export interface GarageSnapshot {
  vehicles: (StoredVehicle & { sharedBy?: SharedInfo })[];
  records: StoredRecord[];
  plans: StoredPlan[];
  documents: StoredDocument[];
  fuel: StoredFuel[];
  workshops: StoredWorkshop[];
}
