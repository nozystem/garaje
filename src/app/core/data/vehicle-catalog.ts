import { VehicleType } from '../models/vehicle.model';

/**
 * Catálogo de marcas y modelos.
 *
 * Curado a mano tras descartar las alternativas externas:
 *
 *  - **NHTSA vPIC** (gratuita, sin registro): es del gobierno de EE.UU. y no
 *    incluye SEAT, Cupra, Dacia ni Škoda, de las marcas más comunes en España.
 *    Buscar "seat" devuelve "Seattle Tiny Homes". Decodificar un VIN europeo
 *    devuelve error o poco más que el año.
 *  - **CarQueryAPI**: fuera de servicio. Su certificado TLS pertenece hoy a
 *    otro dominio y por HTTP responde 403.
 *  - **auto-data.net**: su API es comercial y su robots.txt bloquea el rastreo
 *    automatizado. Además, una clave de pago caduca, y con ella el proyecto.
 *  - **Matrícula**: la DGT no expone API pública; los servicios que existen
 *    cobran por consulta y tratan datos de titularidad.
 *
 * Con el catálogo local el formulario funciona sin conexión y no depende de
 * que un tercero siga vivo. Los modelos son las series comunes del parque
 * español, no un listado exhaustivo: ambos campos admiten texto libre.
 */
export interface CatalogMake {
  name: string;
  types: VehicleType[];
  models: string[];
}

export const CAR_MAKES: CatalogMake[] = [
  { name: 'SEAT', types: ['car'], models: ['Ibiza', 'León', 'Arona', 'Ateca', 'Tarraco', 'Toledo', 'Altea', 'Córdoba', 'Exeo', 'Mii'] },
  { name: 'Cupra', types: ['car'], models: ['Formentor', 'León', 'Ateca', 'Born', 'Terramar', 'Tavascan'] },
  { name: 'Volkswagen', types: ['car', 'van'], models: ['Golf', 'Polo', 'Passat', 'Tiguan', 'T-Roc', 'T-Cross', 'Touran', 'Arteon', 'ID.3', 'ID.4', 'Caddy', 'Transporter', 'Crafter'] },
  { name: 'Renault', types: ['car', 'van'], models: ['Clio', 'Mégane', 'Captur', 'Kadjar', 'Scénic', 'Austral', 'Arkana', 'Zoe', 'Twingo', 'Kangoo', 'Trafic', 'Master'] },
  { name: 'Peugeot', types: ['car', 'van'], models: ['208', '2008', '308', '3008', '408', '5008', '508', 'Partner', 'Rifter', 'Expert', 'Boxer'] },
  { name: 'Citroën', types: ['car', 'van'], models: ['C3', 'C3 Aircross', 'C4', 'C5 Aircross', 'C5 X', 'Berlingo', 'Jumpy', 'Jumper', 'Ami'] },
  { name: 'Dacia', types: ['car'], models: ['Sandero', 'Duster', 'Jogger', 'Logan', 'Spring', 'Bigster'] },
  { name: 'Škoda', types: ['car'], models: ['Octavia', 'Fabia', 'Karoq', 'Kodiaq', 'Superb', 'Scala', 'Kamiq', 'Enyaq'] },
  { name: 'Toyota', types: ['car', 'van'], models: ['Corolla', 'Yaris', 'Yaris Cross', 'C-HR', 'RAV4', 'Aygo X', 'Hilux', 'Prius', 'Land Cruiser', 'Proace'] },
  { name: 'Ford', types: ['car', 'van'], models: ['Fiesta', 'Focus', 'Puma', 'Kuga', 'Mondeo', 'Mustang', 'Transit', 'Transit Custom', 'Ranger'] },
  { name: 'Opel', types: ['car', 'van'], models: ['Corsa', 'Astra', 'Mokka', 'Crossland', 'Grandland', 'Combo', 'Vivaro', 'Movano'] },
  { name: 'Hyundai', types: ['car'], models: ['i10', 'i20', 'i30', 'Tucson', 'Kona', 'Bayon', 'Santa Fe', 'Ioniq 5'] },
  { name: 'Kia', types: ['car'], models: ['Picanto', 'Rio', 'Ceed', 'Stonic', 'Sportage', 'Niro', 'Sorento', 'EV6'] },
  { name: 'Nissan', types: ['car', 'van'], models: ['Micra', 'Juke', 'Qashqai', 'X-Trail', 'Leaf', 'Ariya', 'Townstar', 'Navara'] },
  { name: 'BMW', types: ['car', 'motorcycle'], models: ['Serie 1', 'Serie 2', 'Serie 3', 'Serie 4', 'Serie 5', 'X1', 'X3', 'X5', 'i4', 'iX'] },
  { name: 'Mercedes-Benz', types: ['car', 'van'], models: ['Clase A', 'Clase B', 'Clase C', 'Clase E', 'CLA', 'GLA', 'GLC', 'GLE', 'Vito', 'Sprinter', 'Citan'] },
  { name: 'Audi', types: ['car'], models: ['A1', 'A3', 'A4', 'A5', 'A6', 'Q2', 'Q3', 'Q5', 'Q7', 'e-tron'] },
  { name: 'Fiat', types: ['car', 'van'], models: ['500', '500X', 'Panda', 'Tipo', 'Doblò', 'Ducato', 'Scudo'] },
  { name: 'Mazda', types: ['car'], models: ['2', '3', 'CX-3', 'CX-30', 'CX-5', 'CX-60', 'MX-5'] },
  { name: 'Honda', types: ['car', 'motorcycle'], models: ['Jazz', 'Civic', 'HR-V', 'CR-V', 'ZR-V', 'e:Ny1'] },
  { name: 'Volvo', types: ['car'], models: ['XC40', 'XC60', 'XC90', 'S60', 'V60', 'EX30'] },
  { name: 'MG', types: ['car'], models: ['MG3', 'ZS', 'HS', 'MG4', 'MG5', 'Marvel R'] },
  { name: 'Tesla', types: ['car'], models: ['Model 3', 'Model Y', 'Model S', 'Model X'] },
  { name: 'Mitsubishi', types: ['car'], models: ['Space Star', 'ASX', 'Eclipse Cross', 'Outlander'] },
  { name: 'Suzuki', types: ['car', 'motorcycle'], models: ['Swift', 'Vitara', 'S-Cross', 'Ignis', 'Jimny'] },
  { name: 'Jeep', types: ['car'], models: ['Renegade', 'Compass', 'Avenger', 'Wrangler'] },
  { name: 'Land Rover', types: ['car'], models: ['Defender', 'Discovery', 'Range Rover', 'Evoque', 'Velar'] },
  { name: 'Mini', types: ['car'], models: ['Cooper', 'Countryman', 'Clubman'] },
  { name: 'Alfa Romeo', types: ['car'], models: ['Giulietta', 'Giulia', 'Stelvio', 'Tonale'] },
  { name: 'Lexus', types: ['car'], models: ['UX', 'NX', 'RX', 'ES'] },
  { name: 'Porsche', types: ['car'], models: ['911', 'Cayenne', 'Macan', 'Panamera', 'Taycan'] },
  { name: 'Iveco', types: ['van'], models: ['Daily'] },
];

export const MOTORCYCLE_MAKES: CatalogMake[] = [
  { name: 'Honda', types: ['motorcycle'], models: ['CB125R', 'CB500F', 'CB650R', 'CBR600RR', 'CRF300L', 'Africa Twin', 'Forza 125', 'PCX 125', 'NC750X', 'Transalp'] },
  { name: 'Yamaha', types: ['motorcycle'], models: ['MT-03', 'MT-07', 'MT-09', 'R1', 'R7', 'Tracer 7', 'Ténéré 700', 'XMAX 125', 'NMAX 125', 'TMAX'] },
  { name: 'Kawasaki', types: ['motorcycle'], models: ['Z650', 'Z900', 'Ninja 400', 'Ninja 650', 'Versys 650', 'Vulcan S', 'Eliminator'] },
  { name: 'Suzuki', types: ['motorcycle'], models: ['GSX-S750', 'GSX-R600', 'V-Strom 650', 'V-Strom 800', 'SV650', 'Burgman 125'] },
  { name: 'BMW', types: ['motorcycle'], models: ['R 1250 GS', 'F 900 R', 'S 1000 RR', 'G 310 R', 'C 400 X', 'R nineT'] },
  { name: 'KTM', types: ['motorcycle'], models: ['Duke 125', 'Duke 390', 'Duke 790', '890 Adventure', '1290 Super Duke', 'RC 390'] },
  { name: 'Ducati', types: ['motorcycle'], models: ['Monster', 'Panigale V2', 'Panigale V4', 'Multistrada', 'Scrambler', 'DesertX'] },
  { name: 'Triumph', types: ['motorcycle'], models: ['Street Triple', 'Speed Triple', 'Bonneville', 'Tiger 900', 'Trident 660'] },
  { name: 'Piaggio', types: ['motorcycle'], models: ['Vespa Primavera', 'Vespa GTS', 'Liberty 125', 'Beverly 300', 'MP3'] },
  { name: 'SYM', types: ['motorcycle'], models: ['Symphony 125', 'Jet 14', 'Cruisym 300'] },
  { name: 'Kymco', types: ['motorcycle'], models: ['Agility 125', 'People S 125', 'AK 550', 'X-Town 300'] },
  { name: 'Aprilia', types: ['motorcycle'], models: ['RS 660', 'Tuono 660', 'SR GT 125', 'RSV4'] },
  { name: 'Royal Enfield', types: ['motorcycle'], models: ['Classic 350', 'Meteor 350', 'Himalayan', 'Interceptor 650'] },
  { name: 'Harley-Davidson', types: ['motorcycle'], models: ['Sportster S', 'Nightster', 'Street Bob', 'Pan America'] },
];

/** Marcas que aplican a un tipo de vehículo, ordenadas alfabéticamente. */
export function makesFor(type: VehicleType): CatalogMake[] {
  const source = type === 'motorcycle' ? MOTORCYCLE_MAKES : CAR_MAKES;
  return source
    .filter((make) => make.types.includes(type))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

/** Modelos de una marca para un tipo dado. Vacío si no está en el catálogo. */
export function modelsFor(type: VehicleType, makeName: string): string[] {
  const make = makesFor(type).find(
    (m) => m.name.toLowerCase() === makeName.trim().toLowerCase()
  );
  return make ? [...make.models].sort((a, b) => a.localeCompare(b, 'es')) : [];
}
