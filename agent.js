const express = require('express');
const axios   = require('axios');
const app     = express();
app.use(express.json());

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;   // clave de Dualhook: dh_live_...
const VERIFY_TOKEN   = process.env.VERIFY_TOKEN;
const ANTHROPIC_KEY  = process.env.ANTHROPIC_KEY;
const PHONE_ID       = process.env.PHONE_NUMBER_ID;  // Phone Number ID de Dualhook: 1202232000133126

// Coexistencia por Dualhook: los mensajes se ENVÍAN a la API de Dualhook,
// que es compatible con la de Meta (mismo formato). Solo cambia la URL base.
const API_BASE = 'https://api.dualhook.com/v25.0';

// AVISOS POR TELEGRAM: pedidos, comprobantes y avisos llegan al grupo "Pedidos Donlhy".
// Desde ese grupo Yasley también CONTROLA el bot (botones Pausar / Reactivar).
const TELEGRAM_TOKEN   = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// URL pública del agente (para servir la carta en PDF)
const PUBLIC_URL = process.env.PUBLIC_URL || 'https://donlhy-agente-production.up.railway.app';

// Modelos de Claude:
//  - Haiku para el chat: rápido y económico (~20x más barato que Sonnet).
//  - Sonnet para leer comprobantes (un poco más preciso) y como respaldo del chat.
const MODEL_TEXTO    = 'claude-sonnet-5-5';
const MODEL_VISION   = 'claude-sonnet-5-5';
const MODEL_RESPALDO = 'claude-sonnet-5-5';

// ----- ESTADO EN MEMORIA -----
const estado = {};          // por conversación: controla avisos de pedido
const chats  = {};          // historial de conversación por cliente
const cartaEnviada = {};    // cliente -> timestamp del último envío de carta (anti-spam)
const procesados = new Set();// IDs de mensajes ya procesados (anti-duplicados)
const ultimaActividad = {}; // cliente -> timestamp del último mensaje (para el comando /chats)

const CARTA_COOLDOWN_MS = 3 * 60 * 1000;   // no reenviar la carta antes de 3 min

// ----- CONTROL DE CHATS (coexistencia) -----
// La pausa se controla desde el GRUPO DE TELEGRAM (botones o comandos).
//   - Pausar un chat  -> el agente se calla ahí (hasta reactivar o 8 h).
//   - Reactivar       -> el agente retoma ese chat.
//   - "pausar todo" / "activar todo" -> pausa global.
const pausados = {};        // pausa temporal automática (por eco): tel -> timestamp
const tomados  = {};        // control manual (Yasley atiende): tel -> timestamp
let   pausaGlobal = false;  // pausa para TODOS los chats
const PAUSA_MINUTOS = 30;
const TOMA_MAX_MS = 8 * 60 * 60 * 1000;     // una toma manual se auto-libera a las 8 h

function normalizarTel(n) {
  return String(n || '').replace(/\D/g, '').slice(-10); // últimos 10 dígitos (sin país)
}
function pausarChat(cliente) {
  const k = normalizarTel(cliente);
  if (!k || tomados[k]) return;
  pausados[k] = Date.now();
}
function tomarChat(cliente) {
  const k = normalizarTel(cliente);
  if (!k) return;
  tomados[k] = Date.now();
  delete pausados[k];
}
function reanudarChat(cliente) {
  const k = normalizarTel(cliente);
  if (!k) return;
  delete tomados[k];
  delete pausados[k];
}
function estaPausado(cliente) {
  if (pausaGlobal) return true;
  const k = normalizarTel(cliente);
  const tt = tomados[k];
  if (tt) {
    if (Date.now() - tt < TOMA_MAX_MS) return true;
    delete tomados[k]; // la toma manual expiró (seguridad)
  }
  const t = pausados[k];
  if (!t) return false;
  if (Date.now() - t > PAUSA_MINUTOS * 60 * 1000) { delete pausados[k]; return false; }
  return true;
}

// Normaliza texto para detectar comandos (sin acentos, signos ni mayúsculas)
function normalizar(txt) {
  return (txt || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// IDs de mensajes que envió el PROPIO agente (para no confundir sus ecos con Yasley)
const enviadosIds = new Set();
function recordarEnviado(id) {
  if (!id) return;
  enviadosIds.add(id);
  if (enviadosIds.size > 1000) enviadosIds.delete(enviadosIds.values().next().value);
}

// ===================== HORARIO (hora real de Colombia) =====================
const DIAS  = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
// Festivos de Colombia 2026 (ACTUALIZAR cada año)
const FESTIVOS = new Set([
  '2026-01-01','2026-01-12','2026-03-23','2026-04-02','2026-04-03','2026-05-01',
  '2026-05-18','2026-06-08','2026-06-15','2026-06-29','2026-07-20','2026-08-07',
  '2026-08-17','2026-10-12','2026-11-02','2026-11-16','2026-12-08','2026-12-25'
]);
function ahoraBogota() {
  // Railway corre en UTC; Colombia es UTC-5 todo el año (sin horario de verano).
  return new Date(Date.now() - 5 * 60 * 60 * 1000);
}
function fechaISO(b) {
  return `${b.getUTCFullYear()}-${String(b.getUTCMonth()+1).padStart(2,'0')}-${String(b.getUTCDate()).padStart(2,'0')}`;
}
function estadoNegocio() {
  const b = ahoraBogota();
  const dia  = b.getUTCDay();                     // 0=Dom ... 6=Sab (ya ajustado a Bogotá)
  const hora = b.getUTCHours() + b.getUTCMinutes()/60;
  const festivo = FESTIVOS.has(fechaISO(b));
  let abre, cierra;
  if (dia === 0)                { abre = 14; cierra = 22; } // Domingo 2pm-10pm
  else if (dia >= 1 && dia <= 4){ abre = 15; cierra = 22; } // Lun-Jue 3pm-10pm
  else                          { abre = 14; cierra = 23; } // Vie-Sab 2pm-11pm
  if (festivo && (dia === 0 || dia === 1)) abre = 14;       // festivo: dom/lun abren 2pm
  const abierto = hora >= abre && hora < cierra;
  return { b, dia, hora, abierto, abre, cierra, festivo };
}
function hora12(h) {
  const ap = h >= 12 ? 'p.m.' : 'a.m.';
  let x = h % 12; if (x === 0) x = 12;
  return `${x}:00 ${ap}`;
}
function contextoHorario() {
  const e = estadoNegocio();
  const hh = String(e.b.getUTCHours()).padStart(2,'0');
  const mm = String(e.b.getUTCMinutes()).padStart(2,'0');
  const fecha = `${DIAS[e.dia]} ${e.b.getUTCDate()} de ${MESES[e.b.getUTCMonth()]} de ${e.b.getUTCFullYear()}, ${hh}:${mm}${e.festivo ? ' (festivo)' : ''}`;
  if (e.abierto) {
    return `CONTEXTO ACTUAL (hora de Colombia): ${fecha}. El negocio está ABIERTO en este momento (cierra hoy a las ${hora12(e.cierra)}). Atiende y toma pedidos con normalidad.`;
  }
  const detalle = (e.hora < e.abre)
    ? `HOY abre a las ${hora12(e.abre)}.`
    : `Ya cerró por hoy.`;
  return `CONTEXTO ACTUAL (hora de Colombia): ${fecha}. El negocio está CERRADO en este momento. ${detalle} IMPORTANTE: NO tomes el pedido como si estuviéramos abiertos. Salúdalo con cariño, dile con amabilidad que en este momento estamos cerrados e indícale a qué hora abrimos. Luego ofrécele DOS opciones: (1) dejarle el pedido ANOTADO/PROGRAMADO para tenerlo listo apenas abramos, o (2) comunicarlo con alguien del equipo. Según lo que elija:
- Si quiere dejarlo programado: toma los datos y avisa con una línea aparte: @@AVISAR@@ PEDIDO PROGRAMADO (fuera de horario): <detalle del pedido y datos del cliente>.
- Si prefiere que lo atienda una persona: dile con gusto que ya le avisas al equipo para que lo contacten, y avisa con una línea aparte: @@AVISAR@@ CLIENTE PIDE CONTACTO (fuera de horario): <lo que necesita>.
NUNCA uses @@INICIAL@@ ni @@COMPLETO@@ mientras estemos cerrados (esas son solo para preparar de una).`;
}

// Promoción Pizza Fest Urabá (16–25 oct 2026): Pequeña Napolitana a $22.000.
// Se activa y se apaga sola según la fecha de Colombia.
function contextoPromo() {
  const hoy = fechaISO(ahoraBogota());
  if (hoy >= '2026-10-16' && hoy <= '2026-10-25') {
    return 'PROMOCIÓN ACTIVA — PIZZA FEST URABÁ (del 16 al 25 de octubre): la Pizza Pequeña Napolitana (4 porciones) tiene precio especial de $22.000 (normalmente $28.000). TOMA LA INICIATIVA: no esperes a que pregunten. Al saludar (o apenas haya oportunidad) ofrécela tú mism@ con entusiasmo para animar al cliente a probarla, ej: "¡Y aprovecha que estamos en Pizza Fest! La Napolitana pequeña a solo $22.000 hasta el 25 🍕🎉". Hazlo UNA sola vez, natural y cálida; no la repitas en cada mensaje ni presiones. Si el cliente pide algo económico o una Napolitana, resáltala. La promo aplica SOLO a la Pequeña Napolitana; el resto de precios sigue igual.';
  }
  return '';
}

const SYSTEM = `Eres Lhy, de Donlhy — un restaurante y pizzería de Apartadó, Antioquia, Colombia.
Atiendes a los clientes por WhatsApp con calidez, como una persona del equipo que atiende con cariño — nunca como un bot ni "asistente virtual".
Cuando saludes por primera vez, preséntate por tu nombre (ej: "¡Hola! Soy Lhy, de Donlhy 🍕"). No repitas tu nombre en cada mensaje; solo al inicio o si te lo preguntan.
Tono CÁLIDO, cercano y muy amable, como quien atiende con cariño.
Respuestas CORTAS, claras y precisas (1-2 líneas cuando se pueda), pero siempre dulces.
Trata al cliente con calidez: puedes decir "amig@", "con gusto", "claro que sí", "¡listo!".
NUNCA uses "parce". Emojis con moderación (1 o 2 por mensaje).
NO repitas información ni mandes el mismo mensaje dos veces. No seas cansón: ve al punto con amabilidad.

DATOS DEL NEGOCIO:
- Dirección: Calle 100B #95-60 Barrio Obrero Bloque 1, Apartadó (detrás de la Bomba Zeus vía Barrio López)
- WhatsApp: 3128845147
Cuando te pregunten por la ubicación, solo dar la dirección. No preguntar si van a recoger o pedir domicilio a menos que el cliente lo indique.

CARTA / MENÚ:
- En el PRIMER mensaje del cliente, el sistema le envía la carta en PDF automáticamente. Tú solo salúdalo con calidez, preséntate por tu nombre y menciona que le compartes la carta (ej: "¡Hola! Soy Lhy, de Donlhy 🍕 Te comparto nuestra carta para que elijas 😊"). No hagas nada más para esa carta.
- Si el cliente PIDE la carta/menú/opciones/precios, responde algo cálido y breve y termina con la línea: @@CARTA@@
- NUNCA mandes un link ni menciones el PDF o "el sistema". NO mandes la carta en cada mensaje: solo cuando de verdad la pidan (el sistema además evita repetirla).

HORARIO DE ATENCIÓN:
- Lunes a jueves: 3pm a 10pm
- Viernes y sábado: 2pm a 11pm
- Domingo: 2pm a 10pm
- Festivos (domingo o lunes): abren desde las 2pm.
En CADA conversación te paso un bloque "CONTEXTO ACTUAL" con la fecha/hora real de Colombia y si estamos ABIERTOS o CERRADOS ahora mismo. GUÍATE SIEMPRE por ese bloque. Si estamos CERRADOS, no tomes el pedido como confirmado: ofrece con amabilidad dejarlo programado para cuando abramos.

TIEMPO ESTIMADO:
- Domicilio pizzas pequeñas (hasta 8 porciones): 30 a 45 minutos
- Domicilio pizzas grandes (12 y 16 porciones): aproximadamente 35 minutos
- Para recoger pizzas: 25 minutos
- Lasañas para recoger en el local: aproximadamente 35 minutos

MEDIOS DE PAGO:
- Efectivo
- Transferencia bancaria: Bancolombia ahorros, cuenta 10852443314, a nombre de Maritza Torres Galvis
Preguntar siempre al cliente cómo desea pagar al confirmar el pedido.
Si el cliente elige transferencia, pedirle que envíen la foto del comprobante.

TARIFAS DE DOMICILIO POR BARRIO:
$5.000: Policarpa, Obrero, El Concejo, Diana Cardona, Alfonso López, Antonio Roldán Betancur, San Fernando, Las Brisas, Primero de Mayo, Pueblo Nuevo, La Esperanza, San Judas, 9 de Octubre, La Cadena, El Paraíso, La Esmeralda, Parroquial, Fundadores, Manzanares, Vélez, Simón Bolívar, La Libertad, Laureles, La Serranía, Gualcalá, El Estadio, Nueva Civilización, Corrugados, Chinita, El Rosal, Ortiz, Los Álamos, Nuevo Apartadó, Torres de Comfama, Maderos, Heliconias, Centro, Sena, Villa Oreed
$6.000: 20 de Enero, La Paz, La Alborada, La Arboleda, Santa María La Nueva, El Darién, Pueblo Quemado, Villa del Río, Banacol
$7.000: Urbanización La Navarra, Mateguadua, Chicala, Panamericana, Porvenir
$12.000: El Salvador
$16.000: Control B

DIRECCIÓN Y BARRIO (para domicilios):
- Para cobrar bien el domicilio necesitas el BARRIO (ver tarifas).
- A veces el cliente no da el barrio sino un punto de referencia (ej: "cerca de la iglesia", "al lado del parque"). En ese caso pregúntale con amabilidad el nombre del BARRIO.
- Si el barrio no está en la lista, o la dirección sigue sin quedar clara, dile amablemente que un asesor confirmará el valor y la dirección, y avísale al equipo con una línea aparte: @@AVISAR@@ dirección por confirmar: <lo que dijo el cliente>

TAMAÑOS DE PIZZA Y PORCIONES:
- Personal: 2 porciones
- Pequeña: 4 porciones
- SM6: 6 porciones
- Mediana: 8 porciones
- Familiar: 12 porciones
- Extra: 16 porciones

REGLA DE 2 SABORES (MIXTA):
- Desde Pequeña (4 porciones) en adelante se pueden pedir 2 sabores (pizza mixta).
- Pizza Personal (2 porciones): solo 1 sabor. Si piden 2, dilo con amabilidad.
- PRECIO de una pizza de 2 sabores: se cobra el valor del sabor MÁS CARO de los dos, en ese tamaño. Ej: una SM6 mitad Hawaiana ($43k) y mitad Especial de carnes ($57k) se cobra $57k.
- Solo menciona lo de los 2 sabores si el cliente lo pide; no lo ofrezcas proactivamente.
- Si el cliente CAMBIA el pedido (de mixta a un solo sabor, cambia de tamaño, etc.), vuelve a calcular el precio correcto y confírmaselo claro. El resumen final (@@COMPLETO@@) debe reflejar el pedido DEFINITIVO.

PIZZAS CON PRECIOS (Personal/Pequeña/SM6/Mediana/Familiar/Extra):
Hawaiana (jamón, piña y queso): $16k/$28k/$43k/$55k/$82k/$100k
Margarita (tomate, orégano, albahaca y queso): $16k/$28k/$43k/$55k/$82k/$100k
Salami Pepperoni (salami, pepperoni y queso): $17k/$29k/$44k/$55k/$84k/$103k
Napolitana (champiñones, tomate fresco y seco, pimentón, cebolla, orégano y queso): $16k/$28k/$43k/$55k/$81k/$100k
Jamón y queso (jamón y queso): $16k/$28k/$43k/$55k/$81k/$98k
Pollo y champiñones (pollo, champiñones, maíz tierno, tocineta y queso): $17k/$32k/$47k/$56k/$84k/$103k
Especial de carnes (jamón, salami, pepperoni, pollo, champiñones, tocineta, pimentón y queso): $18k/$36k/$57k/$63k/$95k/$117k
Amancer Jennu's (jamón, salami, pepperoni, pollo, camarón, champiñones, maíz tierno, pimentón y queso): $24k/$40k/$62k/$67k/$101k/$129k
Marinera (anillo de calamar, pulpo, camarón, mejillón, palmitos, tomate seco, pimentón, cebolla y queso): $24k/$40k/$62k/$67k/$101k/$129k
Mexicana (carne molida, pesto, salami, jalapeños, pimentón, ají dulce, sal, cebolla y queso): $21k/$39k/$59k/$66k/$100k/$112k — preguntar siempre si la desean con picante
Paisa (pepperoni, carne molida, chorizo, chicharrón, tocineta, plátano maduro, pimentón y queso): $18k/$38k/$57k/$65k/$95k/$118k
Tropical frutas (piña, durazno, arándanos, cereza y queso): $19k/$30k/$44k/$56k/$80k/$100k
Ranchera (salami, pepperoni, chorizo, tocineta, maíz tierno y queso): $17k/$32k/$47k/$56k/$84k/$106k

REGLA DE INGREDIENTES PERSONALIZADOS:
Si el cliente pide una pizza con ingredientes específicos que no están en la carta, compara con las pizzas disponibles y asigna el precio de la que más se parezca.

PEDIDOS POR PRESUPUESTO (muy importante):
Si el cliente dice cuánto quiere gastar o pide una pizza "de $X" (ej: "una pizza de 30 mil", "tengo 50.000", "algo económico"), NUNCA le digas que no hay. Revisa la carta y ofrécele con calidez 2 o 3 opciones que se ajusten a ese presupuesto (sabores y tamaños que quepan), aprovechando al máximo su dinero. Si con un poquito más alcanza para algo mejor, puedes mencionarlo con amabilidad, sin presionar. Ejemplo: "Con $30.000 te alcanza para una Pequeña (4 porciones) de casi cualquier sabor 😊 ¿Cuál se te antoja? Y con un poquito más, la SM6 ya trae 6 porciones."

ADICIONALES PIZZA (Personal/Pequeña/SM6/Mediana/Familiar/Extra) — SE SUMAN al precio de la pizza:
Borde de queso o bocadillo: $4k/$8k/$10k/$12k/$16k/$18k
Tocineta: $4k/$5k/$7k/$9k/$10k/$11k
Maíz tierno: $4k/$6k/$7k/$9k/$10k/$11k
Piña: $4k/$6k/$7k/$8k/$10k/$13k
Queso extra: $4k/$8k/$10k/$12k/$16k/$18k

LASAÑA (Mini=½ libra / Personal=1 libra / Grande=1 kilo):
Pollo: $16k/$27k/$48k
Mixta (pollo y carne): $15k/$25k/$45k
Carne: $15k/$25k/$45k
Marinera o camarones: $25k/$45k/$86k
Plátano maduro: $16k/$25k/$48k

SÁNDWICHES:
En el momento: Jamón y queso $9k | Gratinado $15k | Pollo $15k
Por encargo: Subway $19k | Ranchero $19k

OTROS:
- Empanadas chilenas: $8k
- Canastas de pollo: $10k — SE HACEN POR ENCARGO

BEBIDAS:
Jugos en agua $7k | Jugos en leche $8k | Gaseosa 350ml $3k | Gaseosa personal $4.5k | Gaseosa 1.5L $8k | Mega 2.5L $11k
Cerveza $5k | Soda saborizada $8k | Soda en vidrio $4k | Granizado $10k | Limonada $9k
NOTA: Gaseosa 350ml solo en el local, NO para domicilios.

OFRECER UN ADICIONAL (upsell, hazlo siempre con cariño):
Cuando el cliente elija su pizza o producto, ofrécele UNA sola vez, de forma natural, un complemento que combine (borde de queso, una gaseosa o jugo bien frío, un adicional). Ej: "¿Te animo con un borde de queso o una gaseosa bien fría? 😋". Si dice que no, sigue sin insistir.

TOMAR PEDIDOS (EN DOS MOMENTOS):

MOMENTO 1 — Apenas tengas CLARO (a) qué pizza/producto quiere (sabor y tamaño) y (b) si es DOMICILIO o para RECOGER, termina tu mensaje con una línea aparte exactamente así:
@@INICIAL@@ <resumen corto: producto + domicilio o recoger>
Ejemplo: @@INICIAL@@ 1 pizza hawaiana familiar - domicilio
(No emitas @@INICIAL@@ si estamos CERRADOS; en ese caso ofrece programar el pedido.)

Luego pide con calidez y de a poco (NUNCA todo de golpe) los datos que falten:
- Si es DOMICILIO: ¿a nombre de quién?, la dirección, el barrio (para confirmar el valor del domicilio) y cómo desea pagar (efectivo o transferencia).
- Si es para RECOGER: ¿a nombre de quién? y cómo desea pagar (efectivo o transferencia).

MOMENTO 2 — Cuando YA tengas TODOS los datos, confirma con algo cálido (ej: "¡Listo amig@! Tu pedido ya quedó, lo estamos preparando 🍕") y termina con:
@@COMPLETO@@ <resumen completo: productos y adicionales, nombre, domicilio o recoger, dirección y barrio (con valor del domicilio) si aplica, forma de pago, total y tiempo estimado>

REGLAS DE LAS SEÑALES (el cliente NUNCA las ve, nunca las menciones):
- @@CARTA@@ envía la carta. @@INICIAL@@ avisa el pedido temprano. @@COMPLETO@@ avisa el pedido final. @@AVISAR@@ <motivo> avisa a una persona del equipo.
- MUY IMPORTANTE: SIEMPRE escribe primero un mensaje cálido y claro PARA EL CLIENTE, y solo DESPUÉS, en una línea aparte, la señal. NUNCA respondas solo con una señal sin texto: el cliente SIEMPRE debe recibir una respuesta tuya (confirmación del pedido, lo que falta, etc.). Si tomas un pedido, confírmaselo con palabras antes de @@INICIAL@@ o @@COMPLETO@@.
- Cada señal va en su propia línea. Emite @@INICIAL@@ una sola vez y @@COMPLETO@@ una sola vez.
- Si lleva Mexicana, pregunta ¿con o sin picante? Si es transferencia, da los datos bancarios y pide la foto del comprobante. Informa el tiempo estimado.

ESCALAR AL EQUIPO con @@AVISAR@@ <motivo> (en una línea aparte), avisando antes al cliente con amabilidad. Úsalo en:
- Refrigerios: no das precios. Di "¡Con gusto! Permíteme un momentico, te comunico con alguien del equipo 🙌" + @@AVISAR@@ consulta de refrigerios.
- Cambio de un pedido ya tomado: "Claro, lo confirmo con el equipo 🙌" + @@AVISAR@@ cambio de pedido: <detalle>.
- Pregunta por el estado o la entrega de su pedido: "Déjame consultar cómo va 🙌" + @@AVISAR@@ consulta estado de domicilio.
- Dirección/barrio que no queda claro.

No le pidas al cliente que califique ni le mandes encuestas; cierra con amabilidad.`;

const ENCUESTA_TIEMPO = 60;

// ===================== ENVÍOS WHATSAPP (Dualhook) =====================
async function enviarMensaje(telefono, mensaje) {
  for (let intento = 1; intento <= 3; intento++) {
    try {
      const res = await axios.post(
        `${API_BASE}/${PHONE_ID}/messages`,
        { messaging_product: 'whatsapp', to: telefono, type: 'text', text: { body: mensaje } },
        { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' }, timeout: 20000 }
      );
      recordarEnviado(res.data?.messages?.[0]?.id);
      return;
    } catch (e) {
      const st = e.response?.status;
      // Error permanente (400/401/403/404): no reintentar.
      if (st && st !== 429 && st < 500) {
        console.error('❌ Error enviar mensaje (permanente):', st, JSON.stringify(e.response?.data || e.message).slice(0, 300));
        return;
      }
      // Transitorio (429 / 5xx / red): reintentar.
      if (intento === 3) {
        console.error('❌ Error enviar mensaje (tras 3 intentos):', st || '', (e.message || '').slice(0, 200));
        return;
      }
      await new Promise(r => setTimeout(r, 600 * intento));
    }
  }
}

async function enviarDocumento(telefono, url, filename, caption) {
  try {
    const res = await axios.post(
      `${API_BASE}/${PHONE_ID}/messages`,
      { messaging_product: 'whatsapp', to: telefono, type: 'document', document: { link: url, filename, caption } },
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' } }
    );
    recordarEnviado(res.data?.messages?.[0]?.id);
  } catch (e) {
    console.error('Error enviar carta:', e.response?.data?.error?.message || e.message);
  }
}

async function obtenerImagenBase64(mediaId) {
  const mediaRes = await axios.get(`${API_BASE}/${mediaId}`, { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } });
  const imageUrl = mediaRes.data.url;
  const imgRes = await axios.get(imageUrl, { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` }, responseType: 'arraybuffer' });
  const base64 = Buffer.from(imgRes.data).toString('base64');
  const contentType = imgRes.headers['content-type'] || 'image/jpeg';
  return { base64, contentType };
}

// Llama a Claude para el chat. Usa el modelo económico (Haiku) y, si ese modelo
// llegara a fallar por un tema del modelo, reintenta con el de respaldo (Sonnet).
async function llamarClaudeTexto(system, messages) {
  const headers = { headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }, timeout: 30000 };
  const base = { max_tokens: 2000, system, messages };
  // Llama al modelo con reintentos ante errores transitorios (sobrecarga/límite/red).
  async function pedir(model) {
    let err;
    for (let intento = 1; intento <= 3; intento++) {
      try {
        const { data } = await axios.post('https://api.anthropic.com/v1/messages', { model, ...base }, headers);
        return data;
      } catch (e) {
        err = e; const st = e.response?.status;
        if (st && st !== 429 && st < 500) throw e;   // permanente -> no reintentar
        await new Promise(r => setTimeout(r, 600 * intento));
      }
    }
    throw err;
  }
  try {
    return await pedir(MODEL_TEXTO);
  } catch (e) {
    const st = e.response?.status;
    if (st === 400 || st === 404) {   // problema del modelo -> respaldo
      console.error('Modelo de chat falló, uso respaldo:', JSON.stringify(e.response?.data || e.message).slice(0, 200));
      return await pedir(MODEL_RESPALDO);
    }
    throw e;
  }
}

// ===================== TELEGRAM (avisos + control del bot) =====================
async function enviarTelegram(mensaje, replyMarkup) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    const body = { chat_id: TELEGRAM_CHAT_ID, text: mensaje };
    if (replyMarkup) body.reply_markup = replyMarkup;
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, body);
  } catch (e) {
    console.error('Error Telegram:', e.response?.data?.description || e.message);
  }
}
// Botones para que Yasley controle el bot en ese chat con un toque
function botonesControl(telefono) {
  return {
    inline_keyboard: [[
      { text: '⏸️ Atiendo yo', callback_data: `p:${telefono}` },
      { text: '▶️ Sigue el bot', callback_data: `a:${telefono}` },
    ]]
  };
}
async function answerCallback(id, texto) {
  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/answerCallbackQuery`,
      { callback_query_id: id, text: texto });
  } catch (_) {}
}
const AYUDA_TG =
`🤖 Control del bot Donlhy (desde este grupo):
• /chats  → lista TODOS los chats recientes con un botón para pausar/reactivar cada uno (úsalo para tomar el control de un chat aunque todavía no haya pedido).
• En cada aviso: toca "⏸️ Atiendo yo" para que el bot se calle en ESE chat, o "▶️ Sigue el bot" para que vuelva.
También por texto:
• /pausar 3001234567  (pausa ese número)
• /activar 3001234567  (reactiva ese número)
• /pausartodo   (pausa el bot en TODOS los chats)
• /activartodo  (reactiva el bot en todos)`;

async function manejarUpdateTelegram(upd) {
  // Botón (callback)
  if (upd.callback_query) {
    const cq = upd.callback_query;
    const [accion, cliente] = String(cq.data || '').split(':');
    if (cliente && accion === 'p') { tomarChat(cliente); await answerCallback(cq.id, '⏸️ Listo, el bot no responderá en ese chat. Atiéndelo tú.'); }
    else if (cliente && accion === 'a') { reanudarChat(cliente); await answerCallback(cq.id, '▶️ Listo, el bot vuelve a responder en ese chat.'); }
    else if (cliente && accion === 't') { // toggle (desde la lista /chats)
      if (estaPausado(cliente)) { reanudarChat(cliente); await answerCallback(cq.id, `▶️ Bot reactivado en ${normalizarTel(cliente)}`); }
      else { tomarChat(cliente); await answerCallback(cq.id, `⏸️ Bot pausado en ${normalizarTel(cliente)}. Atiéndelo tú.`); }
    }
    return;
  }
  const m = upd.message;
  if (!m || !m.text) return;
  if (String(m.chat.id) !== String(TELEGRAM_CHAT_ID)) return; // solo el grupo autorizado
  const t = normalizar(m.text).replace(/^\//, ''); // quita "/" inicial si lo tiene
  if (t === 'pausartodo' || t === 'pausar todo') { pausaGlobal = true;  await enviarTelegram('⏸️ Bot PAUSADO en TODOS los chats. Escribe /activartodo para reactivarlo.'); return; }
  if (t === 'activartodo' || t === 'activar todo'){ pausaGlobal = false; await enviarTelegram('▶️ Bot REACTIVADO en todos los chats.'); return; }
  if (t === 'ayuda' || t === 'comandos' || t === 'help') { await enviarTelegram(AYUDA_TG); return; }
  if (t === 'chats' || t === 'clientes') { // lista de chats activos para tomar el control cuando sea
    const activos = Object.keys(ultimaActividad)
      .sort((a, b) => ultimaActividad[b] - ultimaActividad[a])
      .slice(0, 20);
    if (!activos.length) { await enviarTelegram('Aún no hay chats registrados.'); return; }
    const filas = activos.map(f => {
      const pausado = estaPausado(f);
      return [{ text: `${pausado ? '⏸️' : '🟢'} ${normalizarTel(f)} ${pausado ? '(lo atiendes tú)' : '(bot activo)'}`, callback_data: `t:${f}` }];
    });
    await enviarTelegram('Chats recientes — toca uno para PAUSAR o REACTIVAR el bot en ese chat:', { inline_keyboard: filas });
    return;
  }
  const mm = m.text.match(/(pausar|tomar|activar|continuar|seguir|reactivar)\D*(\d{7,15})/i);
  if (mm) {
    const accion = mm[1].toLowerCase();
    const num = normalizarTel(mm[2]);
    if (/pausar|tomar/.test(accion)) { tomarChat(num);   await enviarTelegram(`⏸️ Bot pausado en el chat ${num}.`); }
    else                             { reanudarChat(num); await enviarTelegram(`▶️ Bot reactivado en el chat ${num}.`); }
  }
}

let tgOffset = 0;
async function telegramLoop() {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    const { data } = await axios.get(
      `https://api.telegram.org/bot${TELEGRAM_TOKEN}/getUpdates`,
      { params: { offset: tgOffset, timeout: 50, allowed_updates: JSON.stringify(['message','callback_query']) }, timeout: 60000 }
    );
    for (const upd of (data.result || [])) {
      tgOffset = upd.update_id + 1;
      try { await manejarUpdateTelegram(upd); } catch (e) { console.error('TG update err:', e.message); }
    }
  } catch (e) {
    if (e.response?.data?.description) console.error('getUpdates:', e.response.data.description);
  }
  setTimeout(telegramLoop, 500);
}
async function iniciarTelegram() {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) return;
  try { await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/deleteWebhook`); } catch (_) {}
  telegramLoop();
}

// ===================== RUTAS =====================
// Rutas livianas para "mantener despierto" el servidor (evita arranques en frío)
app.get('/', (req, res) => res.send('Donlhy agente OK'));
app.get('/health', (req, res) => res.send('ok'));

// Diagnóstico temporal: prueba la llamada a Claude y muestra qué devuelve.
app.get('/diag', async (req, res) => {
  const H = { headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }, timeout: 20000 };
  async function test(payload) {
    try {
      const { data } = await axios.post('https://api.anthropic.com/v1/messages', payload, H);
      return { ok: true, stop: data.stop_reason, types: (data.content || []).map(c => c.type), text: (data.content?.find(c => c.type === 'text')?.text || '').slice(0, 150), usage: data.usage };
    } catch (e) {
      return { ok: false, status: e.response?.status, error: JSON.stringify(e.response?.data || e.message).slice(0, 400) };
    }
  }
  const sys = [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }, { type: 'text', text: 'contexto' }];
  const msg = [{ role: 'user', content: 'Quiero una lasaña' }];
  const sinThinking = await test({ model: MODEL_TEXTO, max_tokens: 500, thinking: { type: 'disabled' }, system: sys, messages: msg });
  const masTokens = await test({ model: MODEL_TEXTO, max_tokens: 1500, system: sys, messages: msg });
  res.json({ model: MODEL_TEXTO, sinThinking, masTokens });
});

app.get('/carta.pdf', (req, res) => {
  res.sendFile(require('path').join(__dirname, 'carta.pdf'));
});

app.get('/webhook', (req, res) => {
  if (req.query['hub.verify_token'] === VERIFY_TOKEN) res.send(req.query['hub.challenge']);
  else res.sendStatus(403);
});

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  try {
    const value = req.body?.entry?.[0]?.changes?.[0]?.value;
    if (!value) return;

    console.log('📥 webhook value:', Object.keys(value).join(','));

    // Ecos de la API = mensajes del PROPIO agente. Se IGNORAN siempre.
    if (Array.isArray(value.message_echoes) && value.message_echoes.length) {
      console.log('🔁 Eco de la API (mensaje del propio agente): ignorado');
      return;
    }

    // Ecos de la app del celular (si Dualhook los enviara): Yasley escribió.
    const echoes = value.smb_message_echoes;
    if (Array.isArray(echoes) && echoes.length) {
      for (const echo of echoes) {
        if (echo.id && enviadosIds.has(echo.id)) continue;
        if (echo.to) { pausarChat(echo.to); console.log(`⏸️ Yasley escribió a ${echo.to}: pausa ${PAUSA_MINUTOS} min`); }
      }
      return;
    }

    // ESTADOS DE ENVÍO: si un mensaje que enviamos FALLA, WhatsApp lo reporta aquí.
    // Lo registramos con detalle para ver el motivo exacto del rechazo.
    if (Array.isArray(value.statuses) && value.statuses.length) {
      for (const st of value.statuses) {
        if (st.status === 'failed' || st.errors) {
          console.error('❌ ENVÍO FALLÓ ->', JSON.stringify(st.errors || st).slice(0, 500));
        } else {
          console.log('📶 estado de envío:', st.status);
        }
      }
      return;
    }

    const msg = value.messages?.[0];
    if (!msg) return;
    console.log('✉️ mensaje tipo:', msg.type, 'de:', msg.from);

    // Anti-duplicados: si ya procesamos este mensaje, no lo repetimos.
    if (msg.id) {
      if (procesados.has(msg.id)) { console.log('↩️ Mensaje duplicado ignorado'); return; }
      procesados.add(msg.id);
      if (procesados.size > 3000) procesados.delete(procesados.values().next().value);
    }

    const from = msg.from;
    ultimaActividad[from] = Date.now();   // para que aparezca en /chats

    // ¿Chat pausado porque Yasley lo atiende? El agente se calla.
    if (estaPausado(from)) {
      console.log(`🙊 Chat ${from} pausado (lo atiende Yasley). El agente no responde.`);
      return;
    }

    // IMAGEN — comprobante de pago
    if (msg.type === 'image') {
      const mediaId = msg.image.media_id || msg.image.id;
      try {
        const { base64, contentType } = await obtenerImagenBase64(mediaId);
        const { data } = await axios.post(
          'https://api.anthropic.com/v1/messages',
          {
            model: MODEL_VISION,
            max_tokens: 1000,
            messages: [{
              role: 'user',
              content: [
                { type: 'image', source: { type: 'base64', media_type: contentType, data: base64 } },
                { type: 'text', text: 'Mira esta imagen. ¿Es un comprobante de pago o transferencia bancaria? Si lo es, lee el VALOR/MONTO pagado y el banco si se ven. Responde SOLO con JSON válido, sin texto adicional: {"comprobante": true, "monto": "$00.000", "banco": "Bancolombia"} o {"comprobante": false}. Si no distingues el monto o el banco, pon null en ese campo.' }
              ]
            }]
          },
          { headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' } }
        );

        const respVision = (data.content.find(c => c.type === 'text')?.text) || '';
        let info = { comprobante: false, monto: null, banco: null };
        try { const m = respVision.match(/\{[\s\S]*\}/); if (m) info = JSON.parse(m[0]); }
        catch (_) { info.comprobante = /true|"si"|\bsi\b/i.test(respVision); }

        if (info.comprobante) {
          const montoTxt = info.monto ? ` por ${info.monto}` : '';
          await enviarMensaje(from,
            `¡Mil gracias por tu pago, amig@! 🙌 Recibimos tu comprobante${montoTxt} y ya lo estamos validando. Tu pedido entra en preparación 🍕 ¿Te puedo ayudar en algo más? 😊`
          );
          await enviarTelegram(
            `💳 COMPROBANTE DE PAGO\n👤 Cliente: ${from}\n💵 Monto: ${info.monto || 'no detectado'}${info.banco ? `\n🏦 Banco: ${info.banco}` : ''}\nPor favor verificar.`,
            botonesControl(from)
          );
        } else {
          await enviarMensaje(from, '¡Hola! Recibimos tu imagen 📸 ¿En qué te puedo ayudar?');
        }
      } catch (e) {
        await enviarMensaje(from, '✅ Recibimos tu imagen. El equipo la está revisando 🙌');
      }
      return;
    }

    // AUDIO / NOTA DE VOZ — no se transcribe; se pide escribir y se avisa a Yasley.
    if (msg.type === 'audio' || msg.type === 'voice') {
      await enviarMensaje(from,
        '¡Hola! 🍕 Con gusto te atiendo. Por aquí es más rápido si me escribes tu pedido o tu pregunta 😊 Así no se me escapa ningún detalle. ¡Gracias!'
      );
      await enviarTelegram(`🎤 NOTA DE VOZ\n👤 Cliente: ${from}\nTe envió un audio. Escúchalo en WhatsApp y atiéndelo.`, botonesControl(from));
      return;
    }

    // Otros tipos (sticker, ubicación, video, contacto, documento): pedir texto amablemente.
    if (msg.type !== 'text') {
      if (['sticker', 'location', 'video', 'contacts', 'document'].includes(msg.type)) {
        await enviarMensaje(from, '¡Hola! 🍕 Con gusto te atiendo. ¿Me escribes tu pedido o tu pregunta en un mensajito de texto? Así te ayudo mejor 😊');
      }
      return;
    }

    // TEXTO
    const text = msg.text.body;

    if (!chats[from]) chats[from] = [];
    chats[from].push({ role: 'user', content: text });
    const esPrimerMensaje = chats[from].length === 1;
    if (chats[from].length > 12) chats[from] = chats[from].slice(-12);

    // Caché de prompts: el SYSTEM (grande y fijo) se cachea para abaratar cada llamada.
    // El contexto de horario va en un bloque aparte porque cambia en cada mensaje.
    const dinamico = contextoHorario() + (contextoPromo() ? '\n\n' + contextoPromo() : '');
    const systemBloques = [
      { type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: dinamico },
    ];
    const data = await llamarClaudeTexto(systemBloques, chats[from]);

    // Separamos las señales internas del texto que ve el cliente.
    let resumenInicial = null, resumenCompleto = null, avisarMotivo = null, mandarCarta = false;
    const limpias = [];
    const textoIA = (data.content.find(c => c.type === 'text')?.text) || '';
    for (const ln of textoIA.split('\n')) {
      const s = ln.trim();
      if (s.startsWith('@@COMPLETO@@'))      resumenCompleto = s.replace('@@COMPLETO@@', '').trim();
      else if (s.startsWith('@@INICIAL@@'))  resumenInicial  = s.replace('@@INICIAL@@', '').trim();
      else if (s.startsWith('@@AVISAR@@'))   avisarMotivo    = s.replace('@@AVISAR@@', '').trim();
      else if (s.includes('@@CARTA@@'))     { mandarCarta = true; const r = ln.replace('@@CARTA@@', '').trim(); if (r) limpias.push(r); }
      else limpias.push(ln);
    }
    let reply = limpias.join('\n').trim();
    // Red de seguridad: jamás dejar una señal interna visible al cliente.
    reply = reply.replace(/@@(INICIAL|COMPLETO|CARTA|AVISAR)@@[^\n]*/gi, '').trim();
    if (esPrimerMensaje) mandarCarta = true; // la carta siempre va en el primer mensaje

    // Red de seguridad: si la respuesta quedó VACÍA (el modelo solo mandó una señal
    // sin texto), igual le mandamos algo cálido al cliente para no dejarlo colgado.
    if (!reply) {
      if (resumenCompleto)      reply = '¡Listo! Tu pedido ya quedó, lo estamos preparando 🍕 ¡Gracias, amig@!';
      else if (resumenInicial)  reply = '¡Perfecto! 🍕 Ya voy armando tu pedido. Cuéntame los datos que faltan y lo dejamos listo 😊';
      else if (avisarMotivo)    reply = '¡Claro! Dame un momentico que ya te ayudo con eso 🙌';
      else if (!mandarCarta)    reply = '¡Hola! 🍕 Con gusto te ayudo. ¿Qué se te antoja hoy?';
    }

    chats[from].push({ role: 'assistant', content: reply });

    if (reply) await enviarMensaje(from, reply);

    // Carta en PDF — con anti-repetición (no mandarla 2-3 veces seguidas)
    if (mandarCarta) {
      const last = cartaEnviada[from];
      if (!last || Date.now() - last > CARTA_COOLDOWN_MS) {
        cartaEnviada[from] = Date.now();
        await enviarDocumento(from, `${PUBLIC_URL}/carta.pdf`, 'Carta Donlhy.pdf',
          '🍕 ¡Nuestra carta! Cuando quieras me dices y armamos tu pedido 😊');
      }
    }

    if (!estado[from]) estado[from] = {};

    // Aviso a una persona del equipo (dirección, cambio, refrigerio, estado…)
    if (avisarMotivo) {
      await enviarTelegram(`🔔 ATENCIÓN (revisar)\n👤 Cliente: ${from}\n📝 ${avisarMotivo}`, botonesControl(from));
    }

    // MOMENTO 1 — pedido con claridad -> aviso temprano (una sola vez)
    if (resumenInicial && !estado[from].inicial) {
      estado[from].inicial = true;
      await enviarTelegram(`🍕 NUEVO PEDIDO (preparando)\n👤 Cliente: ${from}\n\n${resumenInicial}`, botonesControl(from));
    }

    // MOMENTO 2 — pedido completo -> aviso final + encuesta (una sola vez, a la hora)
    if (resumenCompleto) {
      await enviarTelegram(`✅ PEDIDO COMPLETO\n👤 Cliente: ${from}\n\n${resumenCompleto}`, botonesControl(from));
      estado[from] = {};
      // (Encuesta automática desactivada: a Yasley le molestaba que se repitiera.)
    }

  } catch (err) {
    console.error('Error agente Donlhy:', err.response?.status || '', err.response?.data ? JSON.stringify(err.response.data).slice(0, 300) : err.message);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🍕 Agente Donlhy corriendo en puerto ${PORT}`);
  iniciarTelegram();
  // "Despertador": se hace ping a sí mismo cada 4 min para que el servidor no se duerma
  // y no se pierda el primer mensaje tras un rato sin actividad.
  setInterval(() => {
    axios.get(`${PUBLIC_URL}/health`, { timeout: 8000 }).catch(() => {});
  }, 4 * 60 * 1000);
});
