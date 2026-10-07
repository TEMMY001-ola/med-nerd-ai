const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get("/", (req, res) => {
  res.status(200).send("MED NERD AI is running!");
});

// Meta WhatsApp Webhook Verification
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
    console.log("Webhook verified successfully");
    return res.status(200).send(challenge);
  }

  console.log("Webhook verification failed");
  return res.sendStatus(403);
});

// Send a WhatsApp text message
async function sendWhatsAppMessage(to, message) {
  const url = `https://graph.facebook.com/v26.0/${process.env.PHONE_NUMBER_ID}/messages`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.WHATSAPP_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: to,
      type: "text",
      text: {
        body: message
      }
    })
  });

  const data = await response.json();

  console.log("WhatsApp API response:", JSON.stringify(data, null, 2));

  if (!response.ok) {
    throw new Error(`WhatsApp API error: ${JSON.stringify(data)}`);
  }

  return data;
}

// WhatsApp incoming messages
app.post("/webhook", async (req, res) => {
  console.log("WhatsApp webhook received:");
  console.log(JSON.stringify(req.body, null, 2));

  // Respond to Meta immediately
  res.sendStatus(200);

  try {
    const message =
      req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!message) {
      console.log("No incoming WhatsApp message found.");
      return;
    }

    const from = message.from;
    const text = message.text?.body;

    if (!from || !text) {
      console.log("Message has no sender or text.");
      return;
    }

    console.log(`Message from ${from}: ${text}`);

    await sendWhatsAppMessage(
      from,
      "Hello! 👋 MED NERD AI is online. Your message was received successfully."
    );

    console.log("Reply sent successfully.");
  } catch (error) {
    console.error("Failed to send WhatsApp reply:", error);
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`MED NERD AI server running on port ${PORT}`);
});
app.get("/privacy-policy", (req, res) => {
  res.status(200).send(`
    <html>
      <head>
        <title>MED NERD AI Privacy Policy</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
      </head>
      <body style="font-family: Arial, sans-serif; max-width: 800px; margin: 40px auto; padding: 20px; line-height: 1.6;">
        <h1>MED NERD AI Privacy Policy</h1>

        <p><strong>Last updated:</strong> October 7, 2026</p>

        <p>
          MED NERD AI is an educational WhatsApp-based tutoring service
          operated by MED NERD. This Privacy Policy explains how information
          received through the service is handled.
        </p>

        <h2>Information We Receive</h2>
        <p>
          When you interact with MED NERD AI through WhatsApp, we may receive
          information such as your WhatsApp phone number, messages, and
          information necessary to provide the requested educational service.
        </p>

        <h2>How We Use Information</h2>
        <p>
          Information is used to respond to messages, provide educational
          assistance, operate and improve the service, and maintain the
          security and reliability of the platform.
        </p>

        <h2>Data Sharing</h2>
        <p>
          We do not sell personal information. Information may be processed by
          service providers and technology platforms necessary to operate the
          MED NERD AI service, including WhatsApp and Meta's services.
        </p>

        <h2>Data Retention</h2>
        <p>
          Information is retained only for as long as reasonably necessary to
          operate, maintain, and improve the service, or as required by law.
        </p>

        <h2>Contact</h2>
        <p>
          For privacy-related questions, contact MED NERD at
          mednerd50@gmail.com.
        </p>
      </body>
    </html>
  `);
});
