// quizblitz.js
const express = require("express");
const mongoose = require("mongoose");

module.exports = (server, app) => {
  const router = express.Router();


  // --------------------
  // User Schema
  // --------------------
  const quizBlitzUserSchema = new mongoose.Schema({
    uid: { type: String, required: true, unique: true },
    displayName: { type: String },
    photoURL: { type: String },

    xp: { type: Number, default: 0 },
    level: { type: Number, default: 1 },
    coins: { type: Number, default: 0 },

    createdAt: { type: Date, default: Date.now }
  });

  const QuizBlitzUser = mongoose.model(
    "QuizBlitzUser",
    quizBlitzUserSchema
  );

  const XP_PER_LEVEL = 100;

  // --------------------
  // GET USER PROFILE
  // --------------------
  router.get("/user/:uid", async (req, res) => {
    try {
      const user = await QuizBlitzUser.findOne({ uid: req.params.uid });
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      res.json(user);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error" });
    }
  });

  // --------------------
  // CREATE USER (FIRST LOGIN)
  // --------------------
  router.post("/user", async (req, res) => {
    try {
      const { uid, displayName, photoURL } = req.body;
      if (!uid) return res.status(400).json({ error: "UID is required" });

      let user = await QuizBlitzUser.findOne({ uid });

      if (!user) {
        user = new QuizBlitzUser({
          uid,
          displayName,
          photoURL
        });
        await user.save();
      }

      res.json(user);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error" });
    }
  });

  // --------------------
  // ADD XP + AUTO LEVEL
  // --------------------
  router.post("/add-xp", async (req, res) => {
    try {
      const { uid, xpGained } = req.body;
      if (!uid) return res.status(400).json({ error: "UID is required" });

      let user = await QuizBlitzUser.findOne({ uid });
      if (!user) {
        user = new QuizBlitzUser({ uid });
      }

      user.xp += Number(xpGained) || 0;
      user.level = Math.floor(user.xp / XP_PER_LEVEL) + 1;

      await user.save();
      res.json(user);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error" });
    }
  });

  // --------------------
  // LEADERBOARD
  // --------------------
  router.get("/leaderboard", async (req, res) => {
    try {
      const leaderboard = await QuizBlitzUser.find()
        .sort({ level: -1, xp: -1 })
        .limit(10)
        .select("displayName level xp");

      res.json(leaderboard);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error" });
    }
  });

  // --------------------
  // REGISTER ROUTER
  // --------------------
  app.use("/api/quizblitz", router);

  console.log("✅ QuizBlitz backend loaded");
};
