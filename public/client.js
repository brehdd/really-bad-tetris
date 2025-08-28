// client.js - simplified playable demo
const socket = io();
const menu = document.getElementById("homeMenu");
const menuBG = document.getElementById("menuBG");
const btnSingle = document.getElementById("btnSingle");
const btnMulti = document.getElementById("btnMulti");
const btnSettings = document.getElementById("btnSettings");

const gameWrap = document.getElementById("gameWrap");
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const comboEl = document.getElementById("comboEffect");
const usernameInput = document.getElementById("username");
const bgColorInput = document.getElementById("pf-bg");
const saveProfileBtn = document.getElementById("saveProfile");
const rankEl = document.getElementById("playerRank");
const scoreEl = document.getElementById("score");

let players = []; // remote players list for display
let local = {
  profile: {
    username: "player",
    playfield: { width:10, height:20, bgColor:"#071022", blockColors:{} }
  },
  score: 0,
  rank: -1,
  speed: 1000,
  minSpeed: 200,
  speedIncrementPerSecond: 2 // ms per second decrease
};

let playfield = {
  width: 10, height: 20, grid: [],
  activeTetromino: null
};
const blockSize = 24;

// resize canvas to initial playfield
function resetPlayfieldGrid(w,h){
  playfield.width = w; playfield.height = h;
  playfield.grid = Array.from({length:h}, ()=>Array(w).fill(0));
  canvas.width = w * blockSize;
  canvas.height = h * blockSize;
}
resetPlayfieldGrid(10,20);

// menu logic
btnSingle.onclick = ()=> startGame("single");
btnMulti.onclick = ()=> startGame("multi");
btnSettings.onclick = ()=> alert("settings placeholder");

function startGame(mode){
  menu.classList.add("hidden");
  gameWrap.classList.remove("hidden");
  if(mode==="multi"){ joinMultiplayer(); }
  else startSingleplayer();
}

function startSingleplayer(){
  local.profile.username = usernameInput.value || "player";
  // singleplayer uses local resizing logic too: start a local timer to simulate infinite mode
  scheduleLocalBoardResize();
  lastFrame = performance.now();
  gameLoop();
}

function joinMultiplayer(){
  local.profile.username = usernameInput.value || "player";
  socket.emit("joinRoom","main", (res)=>{
    if(!res || !res.ok) { alert("failed to join"); return; }
    players = res.players;
    // set local profile width/height from server data (server schedules resizes)
    // start gameloop
    lastFrame = performance.now();
    gameLoop();
  });
}

// save profile
saveProfileBtn.onclick = ()=>{
  const update = {
    username: usernameInput.value || "player",
    playfield: { bgColor: bgColorInput.value }
  };
  local.profile.username = update.username;
  local.profile.playfield.bgColor = update.playfield.bgColor;
  socket.emit("updateProfile", update, ()=>{});
};

// socket events
socket.on("playerProfileUpdated", ({id, profile})=>{
  const p = players.find(x=>x.id===id);
  if(p) p.profile = profile;
});

socket.on("incomingGarbage", ({lines, from})=>{
  // simple: add garbage rows at bottom
  addGarbageLines(lines);
});

socket.on("comboEffect", ({combo, backToBack})=>{
  if(combo>1) showLineClearEffect(combo);
  else if(backToBack) showCustomText("back-to-back!");
});

socket.on("boardResize", ({width, height})=>{
  startSmoothResize(width, height);
});

socket.on("ranksUpdated", (rankList)=>{
  const me = rankList.find(r=>r.id === socket.id);
  if(me){ local.rank = me.rank; local.score = me.score; rankEl.innerText = `rank: ${me.rank+1}`; scoreEl.innerText = `score: ${me.score}`; }
});

// local scheduling for singleplayer (to match server behavior in multiplayer)
let localResizeTimer = null;
function scheduleLocalBoardResize(){
  clearTimeout(localResizeTimer);
  localResizeTimer = setTimeout(()=>{
    const w = Math.floor(Math.random()*(16-10+1))+10;
    const h = Math.floor(Math.random()*(24-18+1))+18;
    startSmoothResize(w,h);
    scheduleLocalBoardResize();
  }, Math.floor(Math.random()*20000)+30000);
}

// -------------- smooth resize logic --------------
let resizing = false;
let resizeStart = 0;
let resizeDur = 900;
let startW, startH, targetW, targetH;

function startSmoothResize(newW,newH){
  startW = playfield.width; startH = playfield.height;
  targetW = newW; targetH = newH;
  resizeStart = performance.now();
  resizing = true;
}

function updateResize(now){
  if(!resizing) return;
  const t = Math.min((now-resizeStart)/resizeDur, 1);
  const curW = Math.round(startW + (targetW-startW)*t);
  const curH = Math.round(startH + (targetH-startH)*t);

  // create new grid preserving only fully inside blocks
  const old = playfield.grid;
  const newGrid = Array.from({length: curH}, ()=>Array(curW).fill(0));
  for(let y=0;y<Math.min(old.length, curH); y++){
    for(let x=0;x<Math.min(old[0].length, curW); x++){
      newGrid[y][x] = old[y][x];
    }
  }
  playfield.grid = newGrid;
  canvas.width = curW * blockSize;
  canvas.height = curH * blockSize;

  // active tetromino: remove if partially out of bounds
  playfield.activeTetromino = trimActive(playfield.activeTetromino, curW, curH);

  if(t === 1){
    // finalize
    playfield.width = targetW;
    playfield.height = targetH;
    resizing = false;
    // after resize finishes, compute automatic line clears
    const cleared = clearLinesFromResize();
    if(cleared>0){
      showLineClearEffect(cleared);
      // notify server of this clear so multiplayer scoring/garbage works
      const typeMap = {1:"single",2:"double",3:"triple",4:"quad",5:"penta",6:"hex",7:"hepta",8:"octa"};
      const typ = typeMap[cleared] || `${cleared}`;
      socket.emit("lineClear", { type: typ, lines: cleared });
    }
  }
}

function trimActive(active, w, h){
  if(!active) return null;
  const {x: px, y: py, shape} = active;
  for(let y=0;y<shape.length;y++){
    for(let x=0;x<shape[y].length;x++){
      if(shape[y][x]){
        const nx = px+x, ny = py+y;
        if(nx < 0 || nx >= w || ny < 0 || ny >= h) return null;
      }
    }
  }
  return active;
}

function clearLinesFromResize(){
  let lines = 0;
  for(let y=0;y<playfield.grid.length;y++){
    if(playfield.grid[y].every(c=>c!==0)){
      playfield.grid.splice(y,1);
      playfield.grid.unshift(Array(playfield.width).fill(0));
      lines++; y--;
    }
  }
  return lines;
}

// simple garbage: push rows with a hole
function addGarbageLines(n){
  for(let i=0;i<n;i++){
    const hole = Math.floor(Math.random()*playfield.width);
    playfield.grid.shift();
    const row = Array.from({length: playfield.width}, (_,x)=> x===hole?0:1);
    playfield.grid.push(row);
  }
}

// -------------- display helpers --------------
function showLineClearEffect(lines){
  const names = {1:"single!",2:"double!",3:"triple!",4:"quad!",5:"penta!",6:"hex!",7:"hepta!",8:"octa!"};
  showCustomText(names[lines] || `${lines} lines!`);
}

function showCustomText(text){
  comboEl.innerText = (text+"").toLowerCase();
  comboEl.style.display = "block";
  comboEl.style.opacity = 1;
  comboEl.style.transform = "translate(-50%,-50%) scale(1.3)";
  setTimeout(()=>{
    comboEl.style.opacity = 0;
    setTimeout(()=> comboEl.style.display = "none", 300);
  }, 1000);
}

// -------------- simple controls for demo --------------
document.addEventListener("keydown", e=>{
  if(e.key === "z") { // simulate single clear
    doLocalClear(1);
  } else if(e.key === "x"){ doLocalClear(2); }
  else if(e.key === "c"){ doLocalClear(3); }
  else if(e.key === "v"){ doLocalClear(4); }
});

function doLocalClear(count){
  // simply clear bottom N rows for demo
  for(let i=0;i<count;i++){
    playfield.grid.pop();
    playfield.grid.unshift(Array(playfield.width).fill(0));
  }
  showLineClearEffect(count);
  const typeMap = {1:"single",2:"double",3:"triple",4:"quad"};
  socket.emit("lineClear", { type: typeMap[count] || `${count}`, lines: count });
}

// -------------- speed & ranking influence --------------
let lastSpeedTick = performance.now();
function updateSpeed(dtSeconds){
  // speed decreases (ms per drop) over time, down to minSpeed
  local.speed = Math.max(local.minSpeed, local.speed - local.speedIncrementPerSecond * dtSeconds * 1000);
  // rank affects starting speed (higher rank -> faster start)
  const rankFactor = Math.max(0, local.rank) * 20;
  local.speed = Math.max(local.minSpeed, 1000 - rankFactor - (performance.now()/60000)*local.speedIncrementPerSecond*10);
}

// -------------- simple renderer --------------
function draw(){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  // background color
  ctx.fillStyle = local.profile.playfield.bgColor || "#071022";
  ctx.fillRect(0,0,canvas.width,canvas.height);

  // draw grid blocks
  for(let y=0;y<playfield.grid.length;y++){
    for(let x=0;x<playfield.grid[0].length;x++){
      if(playfield.grid[y][x]){
        ctx.fillStyle = "#999";
        ctx.fillRect(x*blockSize, y*blockSize, blockSize-1, blockSize-1);
      }
    }
  }
  // name
  ctx.fillStyle = local.profile.accentColor || "#3dd3ff";
  ctx.font = "14px inter, sans-serif";
  ctx.fillText(local.profile.username || "player", 8, 18);
}

// -------------- main loop --------------
let lastFrame = performance.now();
function gameLoop(now){
  if(!now) now = performance.now();
  const dt = (now - lastFrame);
  lastFrame = now;

  // update speed
  updateSpeed(dt/1000);

  // update resize animation
  updateResize(now);

  // draw
  draw();

  requestAnimationFrame(gameLoop);
}

// start menu background simple animation
(function animateMenuBG(){
  const c = menuBG;
  const g = c.getContext("2d");
  function resize(){ c.width = innerWidth; c.height = innerHeight; }
  resize(); window.addEventListener("resize", resize);
  let t=0;
  function loop(){
    t += 0.02;
    g.clearRect(0,0,c.width,c.height);
    // simple noisy gradient for atmosphere
    const grd = g.createLinearGradient(0,0,c.width,c.height);
    const a = Math.floor(40+20*Math.sin(t));
    const b = Math.floor(20+10*Math.cos(t*1.1));
    grd.addColorStop(0, `rgba(${a},${a},${a},0.2)`);
    grd.addColorStop(1, `rgba(${b},${b},${b},0.25)`);
    g.fillStyle = grd;
    g.fillRect(0,0,c.width,c.height);
    requestAnimationFrame(loop);
  }
  loop();
})();
