const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Home
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

  console.log(
    "WhatsApp API response:",
    JSON.stringify(data, null, 2)
  );

  if (!response.ok) {
    throw new Error(
      `WhatsApp API error: ${JSON.stringify(data)}`
    );
  }

  return data;
}

// Ask Gemini for an answer
async function askGemini(userMessage) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": process.env.GEMINI_API_KEY
      },
      body: JSON.stringify({
        system_instruction: {
          parts: [
            {
              text: `
You are MED NERD AI, an educational AI assistant created by MED NERD.

Your primary audience is students and aspiring university students.

Give clear, accurate and educational answers.

For medical and health-related questions:
- Explain concepts in a student-friendly but scientifically accurate way.
- Do not pretend to diagnose a person.
- Encourage professional medical care when a question involves symptoms, emergencies, diagnosis, or treatment.

For academic questions:
- Teach the concept rather than merely giving an answer.
- Use examples when useful.
- Keep responses reasonably concise for WhatsApp.
- Use simple formatting that displays well on WhatsApp.

Do not claim to be a human doctor or medical professional.
              `
            }
          ]
        },
        contents: [
          {
            role: "user",
            parts: [
              {
                text: userMessage
              }
            ]
          }
        ]
      })
    }
  );

  const data = await response.json();

  console.log(
    "Gemini API response:",
    JSON.stringify(data, null, 2)
  );

  if (!response.ok) {
    throw new Error(
      `Gemini API error: ${JSON.stringify(data)}`
    );
  }

  const answer =
    data.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || "")
      .join("")
      .trim();

  if (!answer) {
    throw new Error("Gemini returned no text answer.");
  }

  return answer;
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

    // Send the user's message to Gemini
    const aiReply = await askGemini(text);

    console.log("AI reply:", aiReply);

    // Send Gemini's answer back to WhatsApp
    await sendWhatsAppMessage(from, aiReply);

    console.log("AI reply sent successfully.");
  } catch (error) {
    console.error(
      "Failed to process WhatsApp message:",
      error
    );
  }
});

// Privacy Policy
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
          operated by MED NERD.
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
          Information is retained only for as long as reasonably necessary
          to operate, maintain, and improve the service, or as required by law.
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

// Start server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`MED NERD AI server running on port ${PORT}`);
});
