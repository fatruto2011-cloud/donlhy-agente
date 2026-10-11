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

// AVISOS POR TELEGRAM: los pedidos, comprobantes, cambios y notas de voz
// se avisan al grupo de Telegram "Pedidos Donlhy" (instantáneo y gratis).
// Así Yasley se entera aunque esté atendiendo una mesa.
const TELEGRAM_TOKEN   = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// URL pública del agente (para servir la carta en PDF)
const PUBLIC_URL = process.env.PUBLIC_URL || 'https://donlhy-agente-production.up.railway.app';

// Estado por conversación (para no avisar el pedido inicial dos veces)
const estado = {};

const chats = {};

// ----- CONTROL DE CHATS (coexistencia) -----
// Cuando Yasley responde a un cliente DESDE la app del celular, Dualhook/Meta
// nos manda un evento "smb_message_echoes" con lo que ella escribió.
//   - Mensaje normal            -> el agente se pausa 30 min en ESE chat.
//   - Escribe "tomar" (o similar)   -> Yasley toma el control (pausa indefinida).
//   - Escribe "continúa" (o similar) -> el agente retoma ese chat de inmediato.
const pausados = {};   // pausa temporal automática: cliente -> timestamp
const tomados  = {};   // control manual de Yasley:   cliente -> true
const PAUSA_MINUTOS = 30;

function pausarChat(cliente) {
  if (!cliente || tomados[cliente]) return; // si ya tomó el control, no lo toca
  pausados[cliente] = Date.now();
}
function tomarChat(cliente) {
  if (!cliente) return;
  tomados[cliente] = true;
  delete pausados[cliente];
}
function reanudarChat(cliente) {
  if (!cliente) return;
  delete tomados[cliente];
  delete pausados[cliente];
}
function estaPausado(cliente) {
  if (tomados[cliente]) return true;            // control manual: siempre pausado
  const t = pausados[cliente];
  if (!t) return false;
  if (Date.now() - t > PAUSA_MINUTOS * 60 * 1000) {
    delete pausados[cliente];
    return false;
  }
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
const CMD_SEGUIR = ['continua','continuar','sigue','sigue tu','seguir','reanudar','activar','activar bot','bot on','activa'];
const CMD_TOMAR  = ['tomar','tomo','tomo yo','yo sigo','yo contesto','yo atiendo','pausar','parar','detener','bot off'];

// IDs de mensajes que envió el PROPIO agente. Sirve para no confundir los ecos
// de sus propios mensajes con mensajes de Yasley (si no, el agente se pausa solo).
const enviadosIds = new Set();
function recordarEnviado(id) {
  if (!id) return;
  enviadosIds.add(id);
  if (enviadosIds.size > 1000) enviadosIds.delete(enviadosIds.values().next().value);
}

const SYSTEM = `Eres Donlhy, un restaurante y pizzería de Apartadó, Antioquia, Colombia.
Hablas directamente como el negocio — nunca como bot ni asistente virtual.
Tono CÁLIDO, cercano y muy amable, como quien atiende con cariño.
Respuestas CORTAS (1-2 líneas cuando se pueda), al grano pero siempre dulces.
Trata al cliente con calidez: puedes decir "amig@", "con gusto", "claro que sí", "¡listo!".
NUNCA uses "parce". Emojis con moderación (1 o 2 por mensaje).

DATOS DEL NEGOCIO:
- Dirección: Calle 100B #95-60 Barrio Obrero Bloque 1, Apartadó (detrás de la Bomba Zeus vía Barrio López)
- WhatsApp: 3128845147
Cuando te pregunten por la ubicación, solo dar la dirección. No preguntar si van a recoger o pedir domicilio a menos que el cliente lo indique.

CARTA / MENÚ:
- PRIMER MENSAJE (saludo): el sistema le envía la carta en PDF automáticamente. Tú solo salúdalo con calidez y menciona que le compartes la carta (ej: "¡Hola, amig@! Bienvenid@ a Donlhy 🍕 Te comparto nuestra carta para que elijas 😊"). No hagas nada más para esa carta.
- CUANDO LA PIDA (en cualquier momento): si el cliente pide ver la carta, el menú, las opciones o los precios en general, responde algo cálido y breve y termina tu mensaje con la línea:
@@CARTA@@
NUNCA mandes un link. No menciones el PDF ni "el sistema".

HORARIO DE ATENCIÓN:
- Lunes a jueves: 3pm a 10pm
- Viernes y sábado: 2pm a 11pm
- Domingo: 2pm a 10pm
- Si es festivo: domingo y lunes inician desde las 2pm (horario de cierre igual)
Si alguien escribe fuera del horario diles amablemente que estamos cerrados pero pueden programar su pedido para cuando abramos.

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
Si el cliente menciona un barrio que no está en la lista, decir que un asesor confirmará el costo de envío.

TAMAÑOS DE PIZZA Y PORCIONES:
- Personal: 2 porciones
- Pequeña: 4 porciones
- SM6: 6 porciones
- Mediana: 8 porciones
- Familiar: 12 porciones
- Extra: 16 porciones

REGLA DE 2 SABORES:
- Desde Pequeña (4 porciones) en adelante se pueden pedir 2 sabores.
- Pizza Personal (2 porciones): si el cliente pide 2 sabores, decirle amablemente que en la personal solo es posible un sabor.
- Solo mencionar esta opción si el cliente la solicita, no preguntarlo proactivamente.

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
Si el cliente dice cuánto quiere gastar o pide una pizza "de $X" (ej: "una pizza de 30 mil", "tengo 50.000", "algo económico"), NUNCA le digas que no hay. Revisa la carta y ofrécele con calidez 2 o 3 opciones que se ajusten a ese presupuesto (los sabores y tamaños que quepan en ese valor), aprovechando al máximo su dinero. Si con un poquito más alcanza para algo mejor (ej: un tamaño más grande o 2 sabores), puedes mencionarlo amablemente, sin presionar. Ejemplo: "Con $30.000 te alcanza para una pizza Pequeña (4 porciones) de casi cualquier sabor 😊 ¿Cuál se te antoja? Y si sumas un poquito más, la SM6 ya trae 6 porciones."

ADICIONALES PIZZA (Personal/Pequeña/SM6/Mediana/Familiar/Extra):
El valor del adicional SE SUMA al precio de la pizza.
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

REFRIGERIOS:
Si un cliente pregunta por refrigerios, decirle: "¡Con gusto! Espera un momentico, te comunico con alguien del equipo 🙌"
No dar precios ni información de refrigerios.

BEBIDAS:
Jugos en agua $7k | Jugos en leche $8k | Gaseosa 350ml $3k | Gaseosa personal $4.5k | Gaseosa 1.5L $8k | Mega 2.5L $11k
Cerveza $5k | Soda saborizada $8k | Soda en vidrio $4k | Granizado $10k | Limonada $9k
NOTA: Gaseosa 350ml solo en el local, NO para domicilios.

OFRECER UN ADICIONAL (upsell, hazlo siempre con cariño):
Cuando el cliente elija su pizza o producto, ofrécele UNA sola vez, de forma natural y cálida, un complemento que combine (ej: borde de queso, una gaseosa o jugo bien frío, o un adicional para la pizza). Ejemplo: "¿Te animo con un borde de queso o una gaseosa bien fría para acompañar? 😋". Si dice que no, continúa sin insistir.

TOMAR PEDIDOS (EN DOS MOMENTOS):

MOMENTO 1 — Apenas tengas CLARO (a) qué pizza/producto quiere (sabor y tamaño) y (b) si es DOMICILIO o para RECOGER, termina tu mensaje con una línea aparte exactamente así:
@@INICIAL@@ <resumen corto: producto + domicilio o recoger>
Ejemplo: @@INICIAL@@ 1 pizza hawaiana familiar - domicilio

Luego pide con calidez y de a poco (NUNCA todo de golpe) los datos que falten:
- Si es DOMICILIO: ¿a nombre de quién va el pedido?, la dirección, el barrio (el barrio sirve para confirmarle el valor del domicilio) y cómo desea pagar (efectivo o transferencia).
- Si es para RECOGER: ¿a nombre de quién? y cómo desea pagar (efectivo o transferencia).

MOMENTO 2 — Cuando YA tengas TODOS los datos, confirma al cliente con algo cálido (ej: "¡Listo amig@! Tu pedido ya quedó, lo estamos preparando 🍕") y termina tu mensaje con:
@@COMPLETO@@ <resumen completo: productos y adicionales, nombre, domicilio o recoger, dirección y barrio (con valor del domicilio) si aplica, forma de pago, total y tiempo estimado>

REGLAS DE LAS SEÑALES:
- Las líneas @@INICIAL@@ y @@COMPLETO@@ son señales internas para la cocina. El cliente NO las ve y tú NUNCA las mencionas ni explicas.
- Emite @@INICIAL@@ una sola vez (la primera vez que haya claridad de pizza + domicilio/recoger).
- Emite @@COMPLETO@@ una sola vez, al final, cuando ya esté todo.
- Si lleva Mexicana, pregunta ¿con o sin picante? Si transferencia, da los datos bancarios y pide la foto del comprobante. Informa el tiempo estimado.

CAMBIOS: di "claro, lo consulto con el equipo" y el sistema notifica.
DOMICILIO: di "con gusto, déjame consultar con el equipo" y el sistema notifica.
ENCUESTA: No la manejes tú, la envía el sistema.`;

const ENCUESTA_TIEMPO = 60;

async function enviarMensaje(telefono, mensaje) {
  const res = await axios.post(
    `${API_BASE}/${PHONE_ID}/messages`,
    {
      messaging_product: 'whatsapp',
      to: telefono,
      type: 'text',
      text: { body: mensaje },
    },
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json',
      },
    }
  );
  recordarEnviado(res.data?.messages?.[0]?.id);
}

async function enviarDocumento(telefono, url, filename, caption) {
  try {
    const res = await axios.post(
      `${API_BASE}/${PHONE_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to: telefono,
        type: 'document',
        document: { link: url, filename: filename, caption: caption },
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );
    recordarEnviado(res.data?.messages?.[0]?.id);
  } catch (e) {
    console.error('Error enviar carta:', e.response?.data?.error?.message || e.message);
  }
}

async function enviarTelegram(mensaje) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
      { chat_id: TELEGRAM_CHAT_ID, text: mensaje }
    );
  } catch (e) {
    console.error('Error Telegram:', e.response?.data?.description || e.message);
  }
}

async function obtenerImagenBase64(mediaId) {
  const mediaRes = await axios.get(
    `${API_BASE}/${mediaId}`,
    { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
  );
  const imageUrl = mediaRes.data.url;
  const imgRes = await axios.get(imageUrl, {
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
    responseType: 'arraybuffer'
  });
  const base64 = Buffer.from(imgRes.data).toString('base64');
  const contentType = imgRes.headers['content-type'] || 'image/jpeg';
  return { base64, contentType };
}

// Servir la carta en PDF (debe existir el archivo carta.pdf en el repo)
app.get('/carta.pdf', (req, res) => {
  res.sendFile(require('path').join(__dirname, 'carta.pdf'));
});

app.get('/webhook', (req, res) => {
  if (req.query['hub.verify_token'] === VERIFY_TOKEN) {
    res.send(req.query['hub.challenge']);
  } else {
    res.sendStatus(403);
  }
});

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  try {
    const value = req.body?.entry?.[0]?.changes?.[0]?.value;
    if (!value) return;

    // Diagnóstico: qué nos manda Dualhook (para ver si llegan los "echoes" de Yasley)
    console.log('📥 webhook value:', Object.keys(value).join(','));

    // Ecos de la API = mensajes que envió el PROPIO agente. Se IGNORAN siempre.
    // (Si no, el agente confunde sus propios mensajes con los de Yasley y se
    //  pausa solo, lo que hace que responda de forma intermitente.)
    if (Array.isArray(value.message_echoes) && value.message_echoes.length) {
      console.log('🔁 Eco de la API (mensaje del propio agente): ignorado');
      return;
    }

    // ECO (coexistencia): Yasley escribió a un cliente DESDE la app del celular.
    const echoes = value.smb_message_echoes;
    if (Array.isArray(echoes) && echoes.length) {
      for (const echo of echoes) {
        // Seguridad: si fuera un eco de un mensaje del propio agente, ignorarlo.
        if (echo.id && enviadosIds.has(echo.id)) continue;
        const cliente = echo.to;   // cliente al que Yasley le escribió
        if (!cliente) continue;
        const cmd = normalizar(echo.text?.body);
        if (CMD_SEGUIR.includes(cmd)) {
          reanudarChat(cliente);
          console.log(`▶️ Yasley reactivó el agente en ${cliente}`);
          await enviarTelegram(`▶️ El agente RETOMÓ el chat con ${cliente} (escribiste "continúa").`);
        } else if (CMD_TOMAR.includes(cmd)) {
          tomarChat(cliente);
          console.log(`⏹️ Yasley tomó el control de ${cliente}`);
          await enviarTelegram(`⏹️ Tomaste el control del chat con ${cliente}. El agente no responderá ahí hasta que escribas "continúa".`);
        } else {
          pausarChat(cliente);
          console.log(`⏸️ Yasley escribió a ${cliente}: agente en pausa ${PAUSA_MINUTOS} min`);
        }
      }
      return;
    }

    const msg = value.messages?.[0];
    if (!msg) return;

    const from = msg.from;

    // ¿Chat pausado porque un humano está atendiendo? El agente se calla.
    if (estaPausado(from)) {
      console.log(`🙊 Chat ${from} pausado (humano atendiendo). El agente no responde.`);
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
            model: 'claude-sonnet-4-6',
            max_tokens: 300,
            messages: [{
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: { type: 'base64', media_type: contentType, data: base64 }
                },
                {
                  type: 'text',
                  text: 'Mira esta imagen. ¿Es un comprobante de pago o transferencia bancaria? Si lo es, lee el VALOR/MONTO pagado y el banco si se ven. Responde SOLO con JSON válido, sin texto adicional, así: {"comprobante": true, "monto": "$00.000", "banco": "Bancolombia"} o {"comprobante": false}. Si no distingues el monto o el banco, pon null en ese campo.'
                }
              ]
            }]
          },
          {
            headers: {
              'x-api-key': ANTHROPIC_KEY,
              'anthropic-version': '2023-06-01',
              'Content-Type': 'application/json',
            }
          }
        );

        // Leemos el comprobante: intentamos sacar monto y banco en JSON.
        const respVision = data.content[0].text || '';
        let info = { comprobante: false, monto: null, banco: null };
        try {
          const m = respVision.match(/\{[\s\S]*\}/);
          if (m) info = JSON.parse(m[0]);
        } catch (_) {
          info.comprobante = /true|"si"|\bsi\b/i.test(respVision);
        }

        if (info.comprobante) {
          const montoTxt = info.monto ? ` por ${info.monto}` : '';
          await enviarMensaje(from,
            `¡Mil gracias por tu pago, amig@! 🙌 Recibimos tu comprobante${montoTxt} y ya lo estamos validando. Tu pedido entra en preparación 🍕\n\n` +
            `Y cuéntame, ¿cómo te ha parecido nuestra atención? 😊 Tu opinión nos ayuda a seguir atendiéndote cada vez mejor.`
          );
          await enviarTelegram(
            `💳 COMPROBANTE DE PAGO\n👤 Cliente: ${from}\n💵 Monto: ${info.monto || 'no detectado'}${info.banco ? `\n🏦 Banco: ${info.banco}` : ''}\nPor favor verificar.`
          );
        } else {
          await enviarMensaje(from, '¡Hola! Recibimos tu imagen 📸 ¿En qué te puedo ayudar?');
        }
      } catch (e) {
        await enviarMensaje(from, '✅ Recibimos tu imagen. El equipo la está revisando 🙌');
      }
      return;
    }

    // AUDIO / NOTA DE VOZ — Opción B: no se transcribe.
    // El agente pide amablemente que escriban, y le avisa a Yasley
    // para que ella escuche la nota desde la app si quiere atenderla.
    if (msg.type === 'audio' || msg.type === 'voice') {
      await enviarMensaje(from,
        '¡Hola! 🍕 Con gusto te atiendo. Por aquí es más rápido si me escribes tu pedido o tu pregunta 😊 ' +
        'Así no se me escapa ningún detalle. ¡Gracias!'
      );
      await enviarTelegram(
        `🎤 NOTA DE VOZ\nCliente: ${from}\nTe envió un audio. Escúchalo en la app de WhatsApp y atiéndelo.`
      );
      return;
    }

    // TEXTO
    if (msg.type !== 'text') return;

    const text = msg.text.body;

    if (!chats[from]) chats[from] = [];
    chats[from].push({ role: 'user', content: text });
    // ¿Es el primer mensaje del cliente en esta conversación? (para enviarle la carta)
    const esPrimerMensaje = chats[from].length === 1;
    if (chats[from].length > 12)
      chats[from] = chats[from].slice(-12);

    const { data } = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-sonnet-4-6',
        max_tokens: 500,
        system: SYSTEM,
        messages: chats[from],
      },
      {
        headers: {
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
      }
    );

    // La respuesta del agente puede traer señales internas (el cliente NO las ve):
    //   @@INICIAL@@  -> pedido con claridad (pizza + domicilio/recoger): aviso temprano
    //   @@COMPLETO@@ -> pedido completo (todos los datos): aviso final + encuesta
    //   @@CARTA@@    -> enviar la carta en PDF
    let reply = data.content[0].text;
    let resumenInicial = null;
    let resumenCompleto = null;
    let mandarCarta = false;

    if (reply.includes('@@COMPLETO@@')) {
      const i = reply.indexOf('@@COMPLETO@@');
      resumenCompleto = reply.slice(i + 12).trim();
      reply = reply.slice(0, i).trim();
    } else if (reply.includes('@@INICIAL@@')) {
      const i = reply.indexOf('@@INICIAL@@');
      resumenInicial = reply.slice(i + 11).trim();
      reply = reply.slice(0, i).trim();
    }
    if (reply.includes('@@CARTA@@')) {
      mandarCarta = true;
      reply = reply.replace('@@CARTA@@', '').trim();
    }
    // GARANTIZADO: en el primer mensaje del cliente siempre se le envía la carta,
    // sin depender de que la IA lo decida.
    if (esPrimerMensaje) mandarCarta = true;

    // Guardamos en el historial la versión LIMPIA (sin señales)
    chats[from].push({ role: 'assistant', content: reply });

    if (reply) await enviarMensaje(from, reply);

    // Carta en PDF (si la pidió)
    if (mandarCarta) {
      await enviarDocumento(
        from,
        `${PUBLIC_URL}/carta.pdf`,
        'Carta Donlhy.pdf',
        '🍕 ¡Nuestra carta! Cuando quieras me dices y armamos tu pedido 😊'
      );
    }

    if (!estado[from]) estado[from] = {};

    // MOMENTO 1 — pedido con claridad -> aviso temprano a cocina (una sola vez)
    if (resumenInicial && !estado[from].inicial) {
      estado[from].inicial = true;
      await enviarTelegram(`🍕 NUEVO PEDIDO (preparando)\n👤 Cliente: ${from}\n\n${resumenInicial}`);
    }

    // MOMENTO 2 — pedido completo -> aviso final + encuesta
    if (resumenCompleto) {
      await enviarTelegram(`✅ PEDIDO COMPLETO\n👤 Cliente: ${from}\n\n${resumenCompleto}`);
      estado[from] = {}; // reinicia para un próximo pedido del mismo cliente
      setTimeout(async () => {
        await enviarMensaje(from,
          '¡Hola de nuevo! Esperamos que hayas disfrutado tu pedido de Donlhy 🍕\n\n' +
          '¿Cómo calificarías tu experiencia?\n' +
          '⭐ 1 - Muy malo\n⭐⭐ 2 - Malo\n⭐⭐⭐ 3 - Regular\n⭐⭐⭐⭐ 4 - Bueno\n⭐⭐⭐⭐⭐ 5 - Excelente\n\n' +
          'Responde con el número 🙏'
        );
      }, ENCUESTA_TIEMPO * 60 * 1000);
    }

    // Refrigerios
    const esRefrigerio = text.toLowerCase().includes('refrigerio');
    if (esRefrigerio) {
      await enviarTelegram(`🥤 CONSULTA REFRIGERIOS\nCliente: ${from}\nMensaje: "${text}"\nPor favor atenderlo.`);
    }

    // Cambios o estado domicilio
    const esCambio = text.toLowerCase().includes('cambiar') || text.toLowerCase().includes('cambio');
    const esEstado = text.toLowerCase().includes('cómo va') || text.toLowerCase().includes('donde está');
    if (esCambio || esEstado) {
      const tipo = esCambio ? '🔄 CAMBIO DE PEDIDO' : '🛵 CONSULTA DOMICILIO';
      await enviarTelegram(`${tipo}\nCliente: ${from}\nMensaje: "${text}"`);
    }

  } catch (err) {
    console.error('Error agente Donlhy:', err.message);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`🍕 Agente Donlhy corriendo en puerto ${PORT}`)
);
