const express = require('express');
const axios   = require('axios');
const app     = express();
app.use(express.json());

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const VERIFY_TOKEN   = process.env.VERIFY_TOKEN;
const ANTHROPIC_KEY  = process.env.ANTHROPIC_KEY;
const PHONE_ID       = process.env.PHONE_NUMBER_ID;
const OWNER_PHONES   = ['573128845147', '573152591416'];

const chats = {};

const SYSTEM = `Eres Donlhy, un restaurante y pizzería de Apartadó, Antioquia, Colombia.
Hablas directamente como el negocio — nunca como bot ni asistente virtual.
Tono joven, parcero, cercano. Respuestas cortas (2-4 líneas). Emojis con moderación.
Usas "parce", "qué más", "bacano", "listo pues" con naturalidad.

DATOS DEL NEGOCIO:
- Dirección: Calle 100B #95-60 Barrio Obrero Bloque 1, Apartadó (detrás de la Bomba Zeus vía Barrio López)
- WhatsApp: 3128845147 | Alterno: 3127439449
- Domicilios a todos los barrios de Apartadó
- Costo de envío varía según barrio, un asesor confirma el valor
- Link de la carta: https://canva.link/tt07ygz7619v470

HORARIO DE ATENCIÓN:
- Lunes a jueves: 3pm a 10pm
- Viernes y sábado: 2pm a 11pm
- Domingo: 2pm a 10pm
- Si es festivo: domingo y lunes inician desde las 2pm (horario de cierre igual)
Si alguien escribe fuera del horario diles amablemente que estamos cerrados pero pueden programar su pedido para cuando abramos.

TIEMPO ESTIMADO:
- Domicilio: 30 a 45 minutos
- Para recoger en el local: 25 minutos

MEDIOS DE PAGO:
- Efectivo
- Transferencia bancaria: Bancolombia ahorros, cuenta 10852443314, a nombre de Maritza Torres Galvis
Preguntar siempre al cliente cómo desea pagar al confirmar el pedido.

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
Mexicana (carne molida, pesto, salami, frijol refrito, jalapeños, pimentón, ají dulce, sal, cebolla y queso): $21k/$39k/$59k/$66k/$100k/$112k — preguntar siempre si la desean con picante
Paisa (pepperoni, carne molida, frijol refrito, chicharrón, tocineta, plátano maduro, pimentón y queso): $18k/$38k/$57k/$65k/$95k/$118k
Tropical frutas (piña, durazno, arándanos, cereza y queso): $19k/$30k/$44k/$56k/$80k/$100k
Ranchera (salami, pepperoni, chorizo, tocineta, maíz tierno y queso): $17k/$32k/$47k/$56k/$84k/$106k

REGLA DE INGREDIENTES PERSONALIZADOS:
Si el cliente pide una pizza con ingredientes específicos que no están en la carta, compara con las pizzas disponibles y asigna el precio de la que más se parezca. Explícale al cliente cuál pizza es la más similar.

ADICIONALES PIZZA (Personal/Pequeña/SM6/Mediana/Familiar/Extra):
El valor del adicional SE SUMA al precio de la pizza.
Borde de queso o bocadillo: $4k/$8k/$10k/$12k/$16k/$18k
Tocineta: $4k/$5k/$7k/$9k/$10k/$11k
Maíz tierno: $4k/$6k/$7k/$9k/$10k/$11k
Piña: $4k/$6k/$7k/$8k/$10k/$13k
Queso extra: $4k/$8k/$10k/$12k/$16k/$18k
Ejemplo: pizza mediana $55k + borde de queso $12k = TOTAL $67k

LASAÑA (Mini=½ libra / Personal=1 libra / Grande=1 kilo):
Pollo: $16k/$27k/$48k
Mixta (pollo y carne): $15k/$25k/$45k
Carne: $15k/$25k/$45k
Marinera o camarones: $25k/$45k/$86k
Plátano maduro: $16k/$25k/$48k — SOLO disponible en Personal (1 libra) y Grande (1 kilo).
Si el cliente pide lasaña de plátano maduro, preguntar si la quiere mixta (pollo y carne) o solo de carne.

SÁNDWICHES:
Se arman en el momento:
- Sándwich jamón y queso: $9k
- Sándwich gratinado: $15k
- Sándwich de pollo: $15k
Por encargo (pedir con anticipación):
- Sándwich tipo Subway: $19k
- Sándwich ranchero: $19k

OTROS: Empanadas chilenas $8k | Canastas de pollo $10k

REFRIGERIOS (disponibles a partir de las 12pm, aplica para canastas y sándwiches):
- Precios por definir — cuando un cliente pregunte por refrigerios después de las 12pm, decir que un asesor confirmará el precio.

BEBIDAS:
Jugos naturales en agua $7k | Jugos naturales en leche $8k
Gaseosa personal $4.5k | Gaseosa 1.5L $8k | Mega gaseosa 2.5L $11k
Cerveza $5k | Soda saborizada $8k | Soda en vidrio (para llevar) $4k | Granizado $10k | Limonada $9k
NOTA: La gaseosa de 350ml NO está disponible para domicilios. Solo para consumo en el local.

COMBOS CON MEGA:
Cuando el cliente pida una Mega (gaseosa 2.5L), sumar $11k al total del pedido.

COTIZACIÓN:
Para pedidos grandes el precio puede variar según la cantidad — comunicar con un asesor.

TOMAR PEDIDOS — recoge en orden:
1. Producto y tamaño (en porciones)
2. Si lleva Mexicana: ¿con o sin picante?
3. Adicionales y su costo sumado al total
4. ¿Domicilio o para recoger?
5. Si es domicilio: NO ofrecer gaseosa 350ml
6. Dirección y nombre (si es domicilio)
7. Medio de pago: ¿efectivo o transferencia?
8. Al confirmar, informar tiempo estimado: 30-45 min domicilio / 25 min para recoger
9. Si paga por transferencia, dar datos: Bancolombia ahorros, cuenta 10852443314, Maritza Torres Galvis

Cuando tengas todo confirma el resumen con el TOTAL incluyendo: qué se pidió, valor total, si es domicilio o recogen, dirección si aplica, y medio de pago. Luego di "listo parce, el equipo lo está confirmando ahora mismo 🙌"

CAMBIOS EN PEDIDO: di "espera un momento, lo consulto con el equipo" y notifica al dueño.
ESTADO DOMICILIO: di "déjame consultar con el equipo" y notifica al dueño.
ENCUESTA: No la manejes tú, la envía el sistema automáticamente.`;

const ENCUESTA_TIEMPO = 60;

async function enviarMensaje(telefono, mensaje) {
  await axios.post(
    `https://graph.facebook.com/v18.0/${PHONE_ID}/messages`,
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
}

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
    const msg = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg || msg.type !== 'text') return;

    const from = msg.from;
    const text = msg.text.body;

    if (!chats[from]) chats[from] = [];
    chats[from].push({ role: 'user', content: text });
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

    const reply = data.content[0].text;
    chats[from].push({ role: 'assistant', content: reply });

    await enviarMensaje(from, reply);

    const esCambio = text.toLowerCase().includes('cambiar') || text.toLowerCase().includes('cambio');
    const esEstado = text.toLowerCase().includes('cómo va') || text.toLowerCase().includes('donde está') || text.toLowerCase().includes('domicilio');

    if (esCambio || esEstado) {
      const tipo = esCambio ? '🔄 CAMBIO DE PEDIDO' : '🛵 CONSULTA DOMICILIO';
      for (const numero of OWNER_PHONES) {
        await enviarMensaje(numero, `${tipo}\nCliente: ${from}\nMensaje: "${text}"`);
      }
    }

    if (reply.toLowerCase().includes('confirmando ahora mismo')) {
      const resumenPedido = `🍕 NUEVO PEDIDO DONLHY\n👤 Cliente: ${from}\n\n${reply}`;
      for (const numero of OWNER_PHONES) {
        await enviarMensaje(numero, resumenPedido);
      }
      setTimeout(async () => {
        await enviarMensaje(from,
          '¡Ey! Esperamos que hayas disfrutado tu pedido de Donlhy 🍕\n\n' +
          '¿Cómo calificarías tu experiencia?\n' +
          '⭐ 1 - Muy malo\n⭐⭐ 2 - Malo\n⭐⭐⭐ 3 - Regular\n⭐⭐⭐⭐ 4 - Bueno\n⭐⭐⭐⭐⭐ 5 - Excelente\n\n' +
          'Responde con el número 🙏'
        );
      }, ENCUESTA_TIEMPO * 60 * 1000);
    }

  } catch (err) {
    console.error('Error agente Donlhy:', err.message);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`🍕 Agente Donlhy corriendo en puerto ${PORT}`)
);
