// itapp.js
const express = require("express");
const mongoose = require("mongoose");
const { Server } = require("socket.io");
const { questionBank } = require("./questions"); // same structure as frontend

module.exports = (server, app) => {
  const router = express.Router();


  // --------------------
  // User Schema
  // --------------------
  const userSchema = new mongoose.Schema({
    uid: { type: String, required: true, unique: true },
    email: { type: String },
    username: { type: String, required: true, unique: true },
    createdAt: { type: Date, default: Date.now }
  });

  const User = mongoose.model("User", userSchema);

  // --------------------
  // User Routes
  // --------------------
  router.get("/user", async (req, res) => {
    try {
      const users = await User.find();
      res.json(users);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error" });
    }
  });

  router.post("/user", async (req, res) => {
    try {
      const { uid, email } = req.body;
      if (!uid) return res.status(400).json({ error: "UID is required" });

      let user = await User.findOne({ uid });
      if (!user) {
        let username, exists = true;
        while (exists) {
          const randomNumber = Math.floor(100000 + Math.random() * 900000);
          username = `player${randomNumber}`;
          exists = await User.findOne({ username });
        }
        user = new User({ uid, email, username });
        await user.save();
      }
      res.json(user);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error" });
    }
  });

  router.put("/user/:uid", async (req, res) => {
    try {
      const { uid } = req.params;
      const { username } = req.body;
      if (!username) return res.status(400).json({ error: "Username is required" });

      const existing = await User.findOne({ username });
      if (existing) return res.status(409).json({ error: "Username already taken" });

      const updatedUser = await User.findOneAndUpdate({ uid }, { username }, { new: true });
      if (!updatedUser) return res.status(404).json({ error: "User not found" });

      res.json(updatedUser);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error" });
    }
  });

  app.use("/api/itapp", router);

  // --------------------
  // Lobby System (Socket.IO)
  // --------------------
  const io = new Server(server, { cors: { origin: "*" } });
  let lobbies = [];

  io.of("/itapp").on("connection", (socket) => {
    console.log("User connected:", socket.id);
    socket.emit("lobbyList", lobbies.map(lobby => ({
      id: lobby.id,
      name: lobby.name,
      hostId: lobby.hostId,
      playerCount: lobby.players.length
    })));

    // --------------------
    // CREATE LOBBY
    // --------------------
    socket.on("createLobby", (payload) => {
      const newLobby = {
        id: socket.id,
        name: typeof payload === "string" ? payload : payload.name,
        hostId: socket.id,
        players: [{
          id: socket.id,
          username: typeof payload === "object" ? payload.username : "HOST",
          ready: false,
          score: 0
        }],
        categories: [
          { name: "Riddles", selected: true, color: "green" },
          { name: "Motivational Trivia", selected: true, color: "green" },
          { name: "Inspirational Challenges", selected: true, color: "green" },
          { name: "History Hacker", selected: false, color: "pink" },
          { name: "Science Surges", selected: false, color: "pink" },
        ],
        game: {
          started: false,
          questions: [],
          currentIndex: 0,
          answers: {},
          leaderboard: [],
          timer: null,
          interval: null
        }
      };

      lobbies.push(newLobby);
      socket.join(newLobby.id);

      socket.emit("joinedLobby", {
        id: newLobby.id,
        name: newLobby.name,
        hostId: newLobby.hostId,
        players: newLobby.players
      });

      io.of("/itapp").emit("lobbyList", lobbies.map(lobby => ({
        id: lobby.id,
        name: lobby.name,
        hostId: lobby.hostId,
        playerCount: lobby.players.length
      })));
    });

    // --------------------
    // JOIN LOBBY
    // --------------------
    socket.on("joinLobby", ({ lobbyId, username }) => {
      const lobby = lobbies.find(l => l.id === lobbyId);
      if (!lobby) return;
      if (lobby.players.find(p => p.id === socket.id)) return;

      const newPlayer = {
        id: socket.id,
        username: username || "PLAYER",
        ready: false,
        score: 0
      };
      lobby.players.push(newPlayer);
      socket.join(lobby.id);

      io.of("/itapp").to(lobby.id).emit("joinedLobby", {
        id: lobby.id,
        name: lobby.name,
        hostId: lobby.hostId,
        players: lobby.players
      });

      io.of("/itapp").emit("lobbyList", lobbies.map(lobby => ({
        id: lobby.id,
        name: lobby.name,
        hostId: lobby.hostId,
        playerCount: lobby.players.length
      })));
    });

    // --------------------
    // REQUEST CURRENT QUESTION
    // --------------------
    socket.on("requestCurrentQuestion", (lobbyId) => {
      const lobby = lobbies.find(l => l.id === lobbyId);
      if (!lobby || !lobby.game.started) return;

      socket.emit("startQuestion", {
        index: lobby.game.currentIndex,
        time: lobby.game.timer || 5,
        questions: lobby.game.questions.map(q => ({
          id: q.id,
          questionText: q.questionText,
          choices: q.choices
        }))
      });

      socket.emit("leaderboardUpdate", lobby.game.leaderboard);
    });

// --------------------
// START GAME (with 10s countdown)
// --------------------
socket.on("startGame", ({ lobbyId, categories }) => {
  const lobby = lobbies.find(l => l.id === lobbyId);
  if (!lobby) return;

  const totalPlayers = lobby.players.length;
  const allReady = lobby.players
    .filter(p => p.id !== lobby.hostId)
    .every(p => p.ready);

  if (totalPlayers < 2 || !allReady) {
    socket.emit("error", {
      message: "Cannot start game: players not ready or not enough players."
    });
    return;
  }

  // Reset player scores
  lobby.players.forEach(p => (p.score = 0));

  // Update selected categories
  lobby.categories = lobby.categories.map(c => ({
    ...c,
    selected: categories.includes(c.name)
  }));

  // --------------------
  // QUESTION PREPARATION
  // --------------------
  const QUESTIONS_PER_CATEGORY = 3;
  let questions = [];

  categories.forEach(cat => {
    if (!questionBank[cat]) return;

    questionBank[cat]
      .sort(() => Math.random() - 0.5)   // shuffle questions
      .slice(0, QUESTIONS_PER_CATEGORY)  // take 5 per category
      .forEach(q => {
        // Shuffle choices safely
        const choices = [...q.choices];
        const correctAnswer = choices[q.correctIndex];

        for (let i = choices.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [choices[i], choices[j]] = [choices[j], choices[i]];
        }

        const newCorrectIndex = choices.indexOf(correctAnswer);

        questions.push({
          ...q,
          choices,
          correctIndex: newCorrectIndex
        });
      });
  });

  // Shuffle all questions together
  questions.sort(() => Math.random() - 0.5);

  // Initialize game state
  lobby.game = {
    started: true,
    questions,
    currentIndex: 0,
    answers: {},
    leaderboard: [],
    timer: null,
    interval: null
  };

  // Notify players
  io.of("/itapp").to(lobby.id).emit("gameStarted", {
    id: lobby.id,
    name: lobby.name,
    hostId: lobby.hostId,
    players: lobby.players,
    categories: lobby.categories,
    game: { questions }
  });

  // --------------------
  // 10s COUNTDOWN
  // --------------------
  let countdown = 10;
  const countdownInterval = setInterval(() => {
    io.of("/itapp").to(lobby.id).emit("countdownTick", countdown);
    countdown--;

    if (countdown < 0) {
      clearInterval(countdownInterval);
      startQuestion(lobby);
    }
  }, 1000);
});

    // --------------------
    // START QUESTION
    // --------------------
    function startQuestion(lobby) {
      const QUESTION_TIME = 10
      lobby.game.answers = {};
      lobby.game.timer = QUESTION_TIME;

      io.of("/itapp").to(lobby.id).emit("startQuestion", {
        index: lobby.game.currentIndex,
        time: QUESTION_TIME,
        questions: lobby.game.questions.map(q => ({
          id: q.id,
          questionText: q.questionText,
          choices: q.choices
        }))
      });

      // Use interval only internally, do NOT send it
      lobby.game.interval = setInterval(() => {
        lobby.game.timer--;
        io.of("/itapp").to(lobby.id).emit("timerTick", lobby.game.timer);

        if (lobby.game.timer <= 0) {
          clearInterval(lobby.game.interval);
          scoreQuestion(lobby);
        }
      }, 1000);
    }

    // --------------------
    // SCORE QUESTION
    // --------------------
    function scoreQuestion(lobby) {
      const question = lobby.game.questions[lobby.game.currentIndex];
      const correctIndex = question.correctIndex;

      Object.entries(lobby.game.answers).forEach(([socketId, answer]) => {
        const player = lobby.players.find(p => p.id === socketId);
        if (!player) return;
        if (answer === correctIndex) player.score += 10;
      });

      lobby.game.leaderboard = [...lobby.players]
        .sort((a, b) => b.score - a.score)
        .map(p => ({ userId: p.id, username: p.username, score: p.score }));

      io.of("/itapp").to(lobby.id).emit("leaderboardUpdate", lobby.game.leaderboard);

      lobby.game.currentIndex++;
      if (lobby.game.currentIndex >= lobby.game.questions.length) {
        io.of("/itapp").to(lobby.id).emit("gameFinished", lobby.game.leaderboard);
        return;
      }

      setTimeout(() => startQuestion(lobby), 3000);
    }

    // --------------------
    // SUBMIT ANSWER
    // --------------------
    socket.on("submitAnswer", ({ lobbyId, answerIndex }) => {
      const lobby = lobbies.find(l => l.id === lobbyId);
      if (!lobby) return;

      if (lobby.game.answers[socket.id] !== undefined) return;
      lobby.game.answers[socket.id] = answerIndex;
    });

    // --------------------
    // TOGGLE READY
    // --------------------
    socket.on("toggleReady", (lobbyId) => {
      const lobby = lobbies.find(l => l.id === lobbyId);
      if (!lobby) return;
      const player = lobby.players.find(p => p.id === socket.id);
      if (player) player.ready = !player.ready;

      io.of("/itapp").to(lobby.id).emit("lobbyUpdated", {
        id: lobby.id,
        name: lobby.name,
        hostId: lobby.hostId,
        players: lobby.players
      });

      io.of("/itapp").emit("lobbyList", lobbies.map(lobby => ({
        id: lobby.id,
        name: lobby.name,
        hostId: lobby.hostId,
        playerCount: lobby.players.length
      })));
    });

    // --------------------
    // LEAVE LOBBY
    // --------------------
    socket.on("leaveLobby", (lobbyId) => {
      const lobby = lobbies.find(l => l.id === lobbyId);
      if (!lobby) return;

      const player = lobby.players.find(p => p.id === socket.id);
      if (player) {
        lobby.players = lobby.players.filter(p => p.id !== socket.id);

        io.of("/itapp").to(lobby.id).emit("playerLeft", {
          userId: player.id,
          username: player.username,
          score: player.score
        });
      }

      if (lobby.players.length === 0) {
        lobbies = lobbies.filter(l => l.id !== lobby.id);
      }

      io.of("/itapp").emit("lobbyList", lobbies.map(lobby => ({
        id: lobby.id,
        name: lobby.name,
        hostId: lobby.hostId,
        playerCount: lobby.players.length
      })));
    });

    // --------------------
    // UPDATE CATEGORIES
    // --------------------
    socket.on("updateCategories", ({ lobbyId, categories }) => {
      const lobby = lobbies.find(l => l.id === lobbyId);
      if (!lobby || lobby.hostId !== socket.id) return;

      lobby.categories = lobby.categories.map(c => ({ ...c, selected: categories.includes(c.name) }));
      io.of("/itapp").to(lobby.id).emit("categoriesUpdated", lobby.categories);
    });

    // --------------------
    // DISCONNECT
    // --------------------
    socket.on("disconnect", () => {
      lobbies.forEach(lobby => {
        const player = lobby.players.find(p => p.id === socket.id);
        if (player) {
          lobby.players = lobby.players.filter(p => p.id !== socket.id);
    
          io.of("/itapp").to(lobby.id).emit("playerLeft", {
            userId: player.id,
            username: player.username,
            score: player.score
          });
    
          // If host left
          if (lobby.hostId === socket.id) {
            io.of("/itapp").to(lobby.id).emit("hostDisconnected");
          }
        }
      });
    
      lobbies = lobbies.filter(lobby => lobby.players.length > 0);
      io.of("/itapp").emit("lobbyList", lobbies.map(lobby => ({
        id: lobby.id,
        name: lobby.name,
        hostId: lobby.hostId,
        playerCount: lobby.players.length
      })));
    });
    
    // --------------------
    // REQUEST LOBBIES
    // --------------------
    socket.on("requestLobbies", () => {
      socket.emit("lobbyList", lobbies.map(lobby => ({
        id: lobby.id,
        name: lobby.name,
        hostId: lobby.hostId,
        playerCount: lobby.players.length
      })));
    });
    // --------------------
    // HOST CHOOSES NEXT STEP
    // --------------------
    socket.on("hostChoice", ({ lobbyId, choice }) => {
      const lobby = lobbies.find(l => l.id === lobbyId);
      if (!lobby) return;
      if (lobby.hostId !== socket.id) return; // Only host can choose

      // Broadcast choice to all players
      io.of("/itapp").to(lobby.id).emit("hostChoice", choice);

      // Optional: if host chose "home", you can clean up the lobby
      if (choice === "home") {
        lobbies = lobbies.filter(l => l.id !== lobbyId);
      }
    });

  });
};

