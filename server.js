// server.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const rooms = {}; // roomId -> Set(socket)

function randomBoardSize(minW=10, maxW=16, minH=18, maxH=24) {
  return {
    width: Math.floor(Math.random()*(maxW-minW+1))+minW,
    height: Math.floor(Math.random()*(maxH-minH+1))+minH
  };
}

function scheduleBoardResizeForSocket(s){
  const delay = Math.floor(Math.random()*20000)+30000; // 30-50s
  s._boardResizeTimer = setTimeout(()=>{
    if(!s.data) return;
    const size = randomBoardSize();
    s.data.playfield.width = size.width;
    s.data.playfield.height = size.height;
    s.emit("boardResize", size);
    scheduleBoardResizeForSocket(s);
  }, delay);
}

function calculateGarbageFromType(type, backToBack, comboCount){
  // base mapping
  const map = {
    single: 0, double: 1, triple: 2,
    quad: 4, penta: 5, hex: 6, hepta: 7, octa: 8
  };
  let base = map[type] || 0;
  if(backToBack) base += 1;
  base += Math.floor(comboCount/2);
  return base;
}

io.on("connection", socket => {
  console.log("connected:", socket.id);

  // default profile & gameplay state
  socket.data = {
    profile: {
      username: `player_${socket.id.slice(0,4)}`,
      avatarURL: "",
      playfield: {
        width: 10,
        height: 20,
        bgColor: "#071022",
        blockColors: { I:"#00f0f0", O:"#f0f000", T:"#a000f0", S:"#00f000", Z:"#f00000", J:"#0000f0", L:"#f0a000" },
        showGhost: true
      },
      fontFamily: "inter, system-ui, sans-serif",
      fontSize: 14,
      accentColor: "#3dd3ff"
    },
    score: 0,
    comboCount: 0,
    backToBack: false,
    lastClearType: null,
    rank: 0
  };

  socket.on("joinRoom", (roomId, ack) => {
    if(!roomId) return ack && ack({ ok:false, error:"no_room" });
    if(!rooms[roomId]) rooms[roomId] = new Set();
    rooms[roomId].add(socket);
    socket.data.roomId = roomId;

    // schedule per-player infinite board resizing
    scheduleBoardResizeForSocket(socket);

    // build list of players
    const players = Array.from(rooms[roomId]).map(s => ({ id: s.id, profile: s.data.profile, score: s.data.score }));
    ack && ack({ ok:true, players });

    socket.to(roomId).emit("playerJoined", { id: socket.id, profile: socket.data.profile, score: socket.data.score });
    updateRanks(roomId);
  });

  socket.on("updateProfile", (update, ack) => {
    try {
      if(update.username) socket.data.profile.username = update.username;
      if(update.avatarURL) socket.data.profile.avatarURL = update.avatarURL;
      if(update.playfield) Object.assign(socket.data.profile.playfield, update.playfield);
      socket.to(socket.data.roomId).emit("playerProfileUpdated", { id: socket.id, profile: socket.data.profile });
      ack && ack({ ok:true });
    } catch(err){ ack && ack({ ok:false, error: err.message }); }
  });

  // player informs server they cleared lines (either via lock or via resize clear)
  socket.on("lineClear", ({ type, lines }) => {
    // update local state & score
    const s = socket;
    const prevType = s.data.lastClearType;
    s.data.backToBack = (type === "quad" || type === "hex" || type === "octa") && prevType === type;
    s.data.comboCount = lines>0 ? s.data.comboCount+1 : 0;
    s.data.lastClearType = type;
    // scoring: simple points
    const points = (lines || 0) * 100 + (s.data.backToBack ? 50 : 0);
    s.data.score = (s.data.score || 0) + points;

    // send garbage to other players in room
    const roomId = s.data.roomId;
    if(roomId && rooms[roomId]){
      const garbage = calculateGarbageFromType(type, s.data.backToBack, s.data.comboCount);
      if(garbage > 0){
        for(const other of rooms[roomId]){
          if(other.id !== s.id) other.emit("incomingGarbage", { lines: garbage, from: s.id });
        }
      }
      // notify player to show combo/back-to-back UI
      s.emit("comboEffect", { combo: s.data.comboCount, backToBack: s.data.backToBack });
      updateRanks(roomId);
    }
  });

  socket.on("disconnect", () => {
    clearTimeout(socket._boardResizeTimer);
    const roomId = socket.data.roomId;
    if(roomId && rooms[roomId]){
      rooms[roomId].delete(socket);
      socket.to(roomId).emit("playerLeft", { id: socket.id });
      updateRanks(roomId);
    }
    console.log("disconnected:", socket.id);
  });

  function updateRanks(roomId){
    if(!roomId || !rooms[roomId]) return;
    // sort players by score desc, assign rank 0 = top
    const arr = Array.from(rooms[roomId]);
    arr.sort((a,b)=> (b.data.score||0) - (a.data.score||0));
    arr.forEach((s,i)=> { s.data.rank = i; });
    // emit rank list
    const rankList = arr.map(s => ({ id: s.id, rank: s.data.rank, score: s.data.score||0 }));
    for(const s of arr) s.emit("ranksUpdated", rankList);
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, ()=> console.log(`listening on :${PORT}`));
