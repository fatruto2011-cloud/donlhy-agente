const express = require('express');
const axios   = require('axios');
const app     = express();
app.use(express.json());

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const VERIFY_TOKEN   = process.env.VERIFY_TOKEN;
const ANTHROPIC_KEY  = process.env.ANTHROPIC_KEY;
const PHONE_ID       = process.env.PHONE_NUMBER_ID;
const OWNER_PHONES   = ['573128845147', '573152591416'];
const YASLEY_PHONE   = '573128845147';

const chats = {};

const SYSTEM = `Eres Donlhy, un restaurante y pizzería de Apartadó, Antioquia, Colombia.
Hablas directamente como el negocio — nunca como bot ni asistente virtual.
Tono joven, parcero, cercano. Respuestas cortas (2-4 líneas). Emojis con moderación.
Usas "parce", "qué más", "bacano", "listo pues" con naturalidad.

DATOS DEL NEGOCIO:
- Dirección: Calle 100B #95-60 Barrio Obrero Bloque 1, Apartadó (detrás de la Bomba Zeus vía Barrio López)
- WhatsApp: 3128845147
- Link de la carta: https://canva.link/tt07ygz7619v470
Cuando te pregunten por la ubicación, solo dar la dirección. No preguntar si van a recoger o pedir domicilio a menos que el cliente lo indique.

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
Plátano maduro: $16k/$25k/$48k — SOLO en Personal y Grande. Preguntar si la quiere mixta o de carne.

SÁNDWICHES:
En el momento: Jamón y queso $9k | Gratinado $15k | Pollo $15k
Por encargo: Subway $19k | Ranchero $19k

OTROS:
- Empanadas chilenas: $8k
- Canastas de pollo: $10k — SE HACEN POR ENCARGO

REFRIGERIOS:
Si un cliente pregunta por refrigerios, decirle: "Espera un momento parce, te comunico con alguien del equipo 🙌"
No dar precios ni información de refrigerios.

BEBIDAS:
Jugos en agua $7k | Jugos en leche $8k | Gaseosa personal $4.5k | Gaseosa 1.5L $8k | Mega 2.5L $11k
Cerveza $5k | Soda saborizada $8k | Soda en vidrio $4k | Granizado $10k | Limonada $9k
NOTA: Gaseosa 350ml solo en el local, NO para domicilios.

TOMAR PEDIDOS:
1. Producto y tamaño
2. Si lleva Mexicana: ¿con o sin picante?
3. Adicionales
4. ¿Domicilio o recoger?
5. Si domicilio: barrio → costo envío → sumarlo
6. Dirección y nombre
7. Medio de pago
8. Si transferencia: datos bancarios + pedir foto del comprobante
9. Informar tiempo estimado

Resumen final debe incluir: productos, valor, domicilio, total, dirección, medio de pago.
Luego di "listo parce, el equipo lo está confirmando ahora mismo 🙌"

CAMBIOS: di "espera, lo consulto con el equipo" y notifica.
DOMICILIO: di "déjame consultar con el equipo" y notifica.
ENCUESTA: No la manejes tú, la envía el sistema.`;

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

async function obtenerImagenBase64(mediaId) {
  const mediaRes = await axios.get(
    `https://graph.facebook.com/v18.0/${mediaId}`,
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
    if (!msg) return;

    const from = msg.from;

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
                  text: 'El cliente envió una imagen. ¿Es un comprobante de pago o transferencia bancaria? Responde solo "SI" o "NO".'
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

        const esComprobante = data.content[0].text.toUpperCase().includes('SI');

        if (esComprobante) {
          await enviarMensaje(from, '✅ ¡Recibimos tu comprobante parce! El equipo lo está verificando y en breve confirmamos tu pedido 🙌');
          for (const numero of OWNER_PHONES) {
            await enviarMensaje(numero, `💳 COMPROBANTE DE PAGO\nCliente: ${from}\nAcaba de enviar foto del comprobante. Por favor verificar.`);
          }
        } else {
          await enviarMensaje(from, '¡Hola! Recibimos tu imagen 📸 ¿En qué te podemos ayudar?');
        }
      } catch (e) {
        await enviarMensaje(from, '✅ Recibimos tu imagen. El equipo la está revisando 🙌');
      }
      return;
    }

    // TEXTO
    if (msg.type !== 'text') return;

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

    // Refrigerios
    const esRefrigerio = text.toLowerCase().includes('refrigerio');
    if (esRefrigerio) {
      await enviarMensaje(YASLEY_PHONE, `🥤 CONSULTA REFRIGERIOS\nCliente: ${from}\nMensaje: "${text}"\nPor favor atenderlo.`);
    }

    // Cambios o estado domicilio
    const esCambio = text.toLowerCase().includes('cambiar') || text.toLowerCase().includes('cambio');
    const esEstado = text.toLowerCase().includes('cómo va') || text.toLowerCase().includes('donde está');

    if (esCambio || esEstado) {
      const tipo = esCambio ? '🔄 CAMBIO DE PEDIDO' : '🛵 CONSULTA DOMICILIO';
      for (const numero of OWNER_PHONES) {
        await enviarMensaje(numero, `${tipo}\nCliente: ${from}\nMensaje: "${text}"`);
      }
    }

    // Pedido confirmado
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
