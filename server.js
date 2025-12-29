const express = require("express");
const cors = require("cors");
const http = require("http");
const mongoose = require("mongoose");
const nodemailer = require("nodemailer");

const app = express();
const server = http.createServer(app);
const PORT = 5000;

app.use(cors());
app.use(express.json());

// --------------------
// MONGODB CONNECTION
// --------------------
mongoose.connect(
  "mongodb+srv://candariarvin_db_user:qleWQ1blytXhZ8Sc@itapp.sm9iedm.mongodb.net/mainDB"
)
.then(() => console.log("MongoDB connected"))
.catch(err => console.error("MongoDB connection error:", err));

// --------------------
// EMAIL ENDPOINT
// --------------------
app.post("/send-subscription-email", async (req, res) => {
  const { email, subject, message } = req.body;

  if (!email || !subject || !message) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    // Configure transporter with your Gmail credentials
    const transporter = nodemailer.createTransport({
      service: "Gmail",
      auth: {
        user: "candari.arvin@gmail.com",        // <-- replace with your Gmail
        pass: "nbrp sqxq jhkt cjnm",   // <-- replace with your password or app password
      },
    });

    // Send email
    await transporter.sendMail({
      from: `"Support Team" <your_email@gmail.com>`, // sender name & email
      to: email,
      subject,
      text: message,
    });

    console.log(`Email sent to ${email}: ${subject}`);
    res.json({ success: true });

  } catch (err) {
    console.error("Failed to send email:", err);
    res.status(500).json({ error: "Failed to send email" });
  }
});

// --------------------
// LOAD BACKEND MODULES
// --------------------
require("./itapp")(server, app);      // itapp routes + socket.io
require("./quizblitz")(server, app);  // quizblitz routes + socket.io

// --------------------
// START SERVER
// --------------------
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
