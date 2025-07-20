// ————————————————— GUI & globale Variablen —————————————————

const guiParams = {
  groundSpeed: 0.5, // Drehrate des Bodens
  orbitSpeed: 0.1, // Rotation der Kamera um Szene
  particleCount: 100, // Partikel pro Explosion
  explosionStrength: 5,  // Wucht der Explosion
  boxCount: 10, // Anzahl Bücher
  fireflyCount: 200, // Glühwürmchen
  spawnRadius: 10, // Radius für Buch-/Partikel-Spawn
  musicVolume: 0.4, // Hintergrundmusik
};

// Zaubersprüche, per Taste ausgelöst
const spells = {
  Feuerball: () => castFireball(),
  Blitz:     () => castLightning(),
  Frost:     () => castFrost()
};

const BREAK_THRESHOLD = 15; // (aktuell nicht genutzt, evtl. später für Bruchlogik)

const gui = new dat.GUI();
gui.add(guiParams, 'groundSpeed', 0, 2).name('Boden-Speed').onChange(v => groundRotationSpeed = v);
gui.add(guiParams, 'orbitSpeed', 0, 0.2).name('Orbit Speed');
gui.add(guiParams, 'particleCount', 10, 500, 1).name('Partikelzahl');
gui.add(guiParams, 'explosionStrength', 1, 20).name('Stärke Puls');
gui.add(guiParams, 'fireflyCount', 0, 1000, 1).name('Anzahl Fireflies').onChange(initFireflies);
gui.add(guiParams, 'boxCount', 0, 100, 1).name('Anzahl Bücher').onChange(initBooks);
gui.add(guiParams, 'spawnRadius', 1, 50 ).name('Spawn-Radius');
gui.add(guiParams, 'musicVolume', 0, 1).name('Musiklautstärke').onChange(v => bgMusic.setVolume(v));
gui.add(spells, 'Feuerball').name('Feuerball (↑)');
gui.add(spells, 'Blitz').name('Blitz (↓)');
gui.add(spells, 'Frost').name('Frost (Leertaste)');

// ————————————————— Globale Objekte —————————————————

let t0 = 0;  // Zeitreferenz für Delta-Berechnung
let scene, camera, renderer, controls;
let ground, tip, wand;
let composer, bloomPass, fireflies;
let world, boxes = [], explosions = [], projectiles = [];
let groundRotationSpeed = guiParams.groundSpeed;
let aimLine;
let bookModel;
let bgMusic;
let timer = 30;         // Countdown in Sekunden
let hitCount = 0;       // Getroffene Bücher
let gameOver = false;   // Spielstatus
let gameStarted = false;
let timerRunning = false;
let timeScale = 1.0;

// ————————————————— Initialisierung —————————————————

initScene(); // Szene & Kamera
initPhysics(); // Physik-Engine
initGround(); // Boden mit Kreis-Textur
initWand(); // Zauberstab
initInput(); // Tastatursteuerung
loadBookModel(initBooks); // Büchermodell laden, dann platzieren
initPostprocessing();
initFireflies(); // Glühwürmchen
initSkyboxEquirect(); // Sternenhimmel
requestAnimationFrame(animate); // Start

// ————————————————— Functions —————————————————
// --- Szene & Renderer ---
function initScene() {
  renderer = new THREE.WebGLRenderer({ canvas: document.querySelector('#c'), antialias: true });
  renderer.setSize(innerWidth, innerHeight);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  scene.add(new THREE.AmbientLight(0x666666));

  const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
  dirLight.position.set(5, 10, 7);
  scene.add(dirLight);

  camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 100);
  camera.position.set(0, 5, 10);

  controls = new THREE.TrackballControls(camera, renderer.domElement);
  controls.staticMoving = true;

  // Ziel-Linie vom Zauberstab
  const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 });
  const lineGeom = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]);
  aimLine = new THREE.Line(lineGeom, lineMat);
  scene.add(aimLine);

  // Resize-Handling
  window.addEventListener('resize', () => {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    controls.handleResize();
    composer.setSize(w, h);
    bloomPass.setSize(w, h);
  });

  // Musik vorbereiten
  const listener = new THREE.AudioListener();
  camera.add(listener);
  bgMusic = new THREE.Audio(listener);

  const loader = new THREE.AudioLoader();
  loader.load('sounds/magic-music.mp3', buffer => {
    bgMusic.setBuffer(buffer);
    bgMusic.setLoop(true);
    bgMusic.setVolume(guiParams.musicVolume);
  });
}

// --- Bücher ---
function loadBookModel(callback) {
  const loader = new THREE.GLTFLoader();
  loader.load('models/open_book.glb', gltf => {
    bookModel = gltf.scene;
    callback();
  });
}

function initBooks() {
  if (!bookModel) return;

  boxes.forEach(b => {
    scene.remove(b.mesh);
    world.removeBody(b.body);
  });
  boxes.length = 0;

  const R = guiParams.spawnRadius;

  for (let i = 0; i < guiParams.boxCount; i++) {
    const mesh = bookModel.clone(true);
    mesh.scale.set(2, 2, 2);
    mesh.position.set(
      (Math.random() - 0.5) * 2 * R,
      3 + Math.random() * 2,
      (Math.random() - 0.5) * 2 * R
    );

    mesh.rotation.z = (Math.random() - 0.5) * 0.2;
    scene.add(mesh);

    const shape = new CANNON.Box(new CANNON.Vec3(0.4, 0.2, 0.6));
    const body = new CANNON.Body({ mass: 2 });
    body.addShape(shape);
    body.position.copy(mesh.position);
    world.addBody(body);

    boxes.push({ mesh, body });
  }

  boxes.forEach(b => {
    b.mesh.userData.baseY = b.mesh.position.y;
    b.mesh.userData.phase = Math.random() * Math.PI * 2;
  });
}

// --- Physik ---
function initPhysics() {
  world = new CANNON.World();
  world.gravity.set(0, 0, 0);
  world.broadphase = new CANNON.NaiveBroadphase();

  const groundBody = new CANNON.Body({ mass: 0 });
  groundBody.addShape(new CANNON.Plane());
  groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(groundBody);
}

// --- Postprocessing Effekte ---
function initPostprocessing() {
  const renderPass = new THREE.RenderPass(scene, camera);
  bloomPass = new THREE.UnrealBloomPass(
    new THREE.Vector2(innerWidth, innerHeight),
    0.5, 0.4, 0.85
  );
  bloomPass.renderToScreen = false;

  const rgbShiftPass = new THREE.ShaderPass(THREE.RGBShiftShader);
  rgbShiftPass.uniforms['amount'].value = 0.0015;  // kleiner Wert für dezenten Effekt
  rgbShiftPass.renderToScreen = true;             // letzter Pass

  composer = new THREE.EffectComposer(renderer);
  composer.addPass(renderPass);
  composer.addPass(bloomPass);
  composer.addPass(rgbShiftPass);
}

// --- Sternenhimmel ---
function initSkyboxEquirect() {
  new THREE.TextureLoader().load('milky_way_skybox_hdri_panorama/textures/material_emissive.png', tex => {
    tex.mapping = THREE.EquirectangularReflectionMapping;
    scene.background = tex;
  });
}

// --- Start-Button (Audio starten) ---
startButton.addEventListener('click', () => {
  if (bgMusic && !bgMusic.isPlaying) {
    if (bgMusic.context.state === 'suspended') {
      bgMusic.context.resume();
    }
    bgMusic.play();
  }
  gameStarted = true;
  timerRunning = true;
  document.getElementById("hud").style.display = "block";
  startButton.style.display = 'none';
});

// --- Boden (magischer Kreis) ---
function initGround() {
  const tex = new THREE.TextureLoader().load('magic_circle.png');
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;

  ground = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 20),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide })
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
}

// --- Zauberstab ---
function initWand() {
  const stickMat = new THREE.MeshPhongMaterial({ color: 0x552200 });
  const tipMat = new THREE.MeshPhongMaterial({ color: 0xffaa00, emissive: 0x442200, emissiveIntensity: 10 });

  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 4), stickMat);
  tip = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 16), tipMat);
  stick.position.y = 2;
  tip.position.y = 4.1;

  wand = new THREE.Group();
  wand.add(stick, tip);
  scene.add(wand);
}

// --- Glühwürmchen (Fireflies) ---
function initFireflies() {
  if (fireflies) scene.remove(fireflies);

  const count = guiParams.fireflyCount, R = guiParams.spawnRadius;
  const posArr = new Float32Array(count*3);
  for (let i=0; i<count; i++) {
    posArr[3*i  ] = (Math.random()-0.5)*2*R;
    posArr[3*i+1] = Math.random()*5 +1;
    posArr[3*i+2] = (Math.random()-0.5)*2*R;
  }
  const geom = new THREE.BufferGeometry().addAttribute('position', new THREE.BufferAttribute(posArr,3));
  fireflies = new THREE.Points(geom, new THREE.PointsMaterial({
    color:0xffff66, size:0.1, transparent:true, opacity:0.8, sizeAttenuation:true
  }));
  scene.add(fireflies);
}

// --- Tastatursteuerung (Input) ---
function initInput() {
  window.addEventListener('keydown', ev => {
    switch (ev.code) {
      case 'ArrowUp': spells.Feuerball(); break;
      case 'ArrowDown': spells.Blitz(); break;
      case 'Space': spells.Frost(); break;
    }
  });
}

// --- Bücher zerstören ---
function breakBox(idx) {
  const { mesh, body } = boxes[idx];
  scene.remove(mesh);
  world.removeBody(body);
  boxes.splice(idx, 1);
  hitCount++;
}

// --- Spiel ende ---
function showGameOver() {
  document.getElementById("finalHits").textContent = hitCount;
  document.getElementById("gameOverScreen").style.display = "block";
}

// --- Neustart ---
function restartGame() {
  timer = 30;
  hitCount = 0;
  gameOver = false;
  document.getElementById("gameOverScreen").style.display = "none";
  initBooks(); // Bücher neu platzieren
}


// ————————————————— Spells —————————————————
// --- Zaubersprüche: Explosionseffekt ---
function createExplosion(center) {
  const count = guiParams.particleCount;
  const geo   = new THREE.BufferGeometry();
  const pos   = new Float32Array(count * 3);
  const vels  = [];
  
  for (let i = 0; i < count; i++) {
    pos[3*i  ] = center.x;
    pos[3*i+1] = center.y;
    pos[3*i+2] = center.z;
    const s = guiParams.explosionStrength;
    const dir = new THREE.Vector3(
      Math.random() * 2 - 1,
      Math.random() * 2 - 1,
      Math.random() * 2 - 1
    ).normalize().multiplyScalar(4 * s);
    vels.push(dir);
  }

  if ( typeof geo.setAttribute === 'function' ) {
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  } else {
    geo.addAttribute('position', new THREE.BufferAttribute(pos, 3));
  }

  const mat = new THREE.PointsMaterial({ color: 0xffee88, size: 0.5, sizeAttenuation: true });
  const pts = new THREE.Points(geo, mat);
  pts.userData = { vels, age: 0 };
  scene.add(pts);
  explosions.push(pts);

  const radius = 5;
  const explosionPoint = new CANNON.Vec3(center.x, 0.5, center.z);

  boxes.forEach(b => {
    const bodyPos = b.body.position;
    const dist3d = bodyPos.distanceTo(new CANNON.Vec3(center.x, center.y, center.z));
    if (dist3d < radius) {
      const dirC = bodyPos.vsub(new CANNON.Vec3(center.x, center.y, center.z)).unit();
      dirC.y = Math.abs(dirC.y);
      const strength = (1 - dist3d / radius) * guiParams.explosionStrength * 10;
      b.body.applyImpulse(dirC.scale(strength), bodyPos);
    }
  });
}

// --- Zauberspruch: Feuerball ---
function castFireball() {
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(0.3,16,16),
    new THREE.MeshBasicMaterial({ color:0xff5522, emissive:0x442200 })
  );
  scene.add(ball);

  const start = new THREE.Vector3();
  const dir   = new THREE.Vector3();

  tip.getWorldPosition(start);
  ball.position.copy(start);

  tip.getWorldDirection(dir);
  dir.normalize();

  const speed = 15;
  projectiles.push({
    mesh:     ball,
    velocity: dir.multiplyScalar(speed),
    life:     0,
    maxLife:  1.5
  });
}

// --- Zauberspruch: Blitz ---
function castLightning() {
  const start = new THREE.Vector3();
  tip.getWorldPosition(start);

  const dir = new THREE.Vector3();
  tip.getWorldDirection(dir).normalize();

  const end = start.clone().add(dir.clone().multiplyScalar(100)); // lang und tödlich

  const pts = [];
  for (let i = 0; i <= 20; i++) {
    const p = start.clone().lerp(end, i / 20);
    if (i > 0 && i < 20) {
      p.add(new THREE.Vector3(
        (Math.random() - 0.5) * 0.5,
        (Math.random() - 0.5) * 0.5,
        (Math.random() - 0.5) * 0.5
      ));
    }
    pts.push(p);
  }

  const curve = new THREE.CatmullRomCurve3(pts);
  const bolt = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 20, 0.1, 8, false),
    new THREE.MeshBasicMaterial({ color: 0x99eeff, transparent: true, opacity: 0.95 })
  );
  scene.add(bolt);
  setTimeout(() => scene.remove(bolt), 150);

  const raycaster = new THREE.Raycaster(start, dir, 0, 100);
  const hitBoxes = boxes.filter(b => {
    const pos = b.mesh.position;
    const toBox = pos.clone().sub(start);
    const projLength = toBox.dot(dir);

    if (projLength < 0 || projLength > 100) return false;

    const closestPoint = start.clone().add(dir.clone().multiplyScalar(projLength));
    const distance = closestPoint.distanceTo(pos);
    return distance < 1.2; 
  });

  hitBoxes.forEach(b => {
    createExplosion(b.mesh.position.clone());
    breakBox(boxes.indexOf(b));
  });
}

// --- Zauberspruch: Frost ---
function castFrost() {
  const origin = new THREE.Vector3();
  tip.getWorldPosition(origin);

  const count = 500;
  const positions = new Float32Array(count * 3);
  const velocities = [];

  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.random() * 0.5;
    const spread = 2;

    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const y = (Math.random() - 0.5) * 0.3;

    positions[3 * i    ] = origin.x + x;
    positions[3 * i + 1] = origin.y + y;
    positions[3 * i + 2] = origin.z + z;

    const dir = new THREE.Vector3(
      x * 0.2 + (Math.random() - 0.5) * 0.1,
      y * 0.2 + (Math.random() - 0.5) * 0.1,
      -spread + Math.random() * 0.5
    );
    velocities.push(dir);
  }

  const geom = new THREE.BufferGeometry();
  geom.addAttribute('position', new THREE.BufferAttribute(positions, 3));

  const mat = new THREE.PointsMaterial({
    color: 0x88ccff,
    size: 1.0,              
    transparent: true,
    opacity: 1.0,             
    depthWrite: false,
    sizeAttenuation: true
  });

  const particles = new THREE.Points(geom, mat);
  particles.userData = { vels: velocities, age: 0 };
  scene.add(particles);
  explosions.push(particles);
 
  timeScale = 0.3;               // Szene läuft mit 30 % Speed
  setTimeout(() => {
    timeScale = 1.0;             // nach 3 Sekunden zurück auf Normal
  }, 3000);
}

// ————————————————— Hauptanimations Loop —————————————————
function animate(time) {
  const rawDt = (time - t0) * 0.001;
  t0 = time;
  const dt  = rawDt * timeScale;

  if (!gameOver && timerRunning) {
    timer -= dt;
    if (timer <= 0) {
      timer = 0;
      gameOver = true;
      showGameOver();
    }
  }

  // --- Projektile bewegen und prüfen ---
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    p.mesh.position.addScaledVector(p.velocity, dt);
    p.life += dt;

    // --- Treffer mit Bücher prüfen ---
    for (let j = boxes.length - 1; j >= 0; j--) {
      const b = boxes[j];
      const dist = p.mesh.position.distanceTo(b.mesh.position);
      if (dist < 1) {
        createExplosion(p.mesh.position.clone());
        breakBox(j);
        scene.remove(p.mesh);
        projectiles.splice(i, 1);
        break;
      }
    }

    // --- Lebenszeit abgelaufen ---
    if (p.life > p.maxLife) {
      createExplosion(p.mesh.position.clone());
      scene.remove(p.mesh);
      projectiles.splice(i, 1);
    }
  }

  // --- Zauberstab leicht rotieren lassen ---
  const wandSpeedFactor = 1.5;
  wand.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), dt * guiParams.orbitSpeed * wandSpeedFactor * Math.PI * 2);

  controls.update();
  ground.rotation.z += dt * groundRotationSpeed;

  // --- Explosionen updaten ---
  for (let i = explosions.length - 1; i >= 0; i--) {
    const p = explosions[i];
    const posA = p.geometry.attributes.position;
    const vels = p.userData.vels;
    p.userData.age += dt;
  
    if (!vels) continue;
  
    const len = posA.array.length / 3;
    for (let j = 0; j < len; j++) {
      posA.array[3 * j    ] += vels[j].x * dt;
      posA.array[3 * j + 1] += vels[j].y * dt - 9.8 * dt * 0.2;
      posA.array[3 * j + 2] += vels[j].z * dt;
    }
    posA.needsUpdate = true;
  
    if (p.userData.age > 2) {
      scene.remove(p);
      explosions.splice(i, 1);
    }
  }

  // --- Glühwürmchen leicht oszillieren lassen ---
  if (fireflies) {
    const arr = fireflies.geometry.attributes.position.array;
    for (let i = 1; i < arr.length; i += 3) {
      arr[i] += Math.sin(time * 0.001 + i) * 0.0001;
    }
    fireflies.geometry.attributes.position.needsUpdate = true;
  }

  // --- Physik-Simulation ausführen ---
  world.step(1 / 60, dt, 3);
  const t = time * 0.001;

  boxes.forEach(b => {
    // --- Physik synchronisieren ---
    b.mesh.position.copy(b.body.position);
    b.mesh.quaternion.copy(b.body.quaternion);

    // --- Visuelles Wackeln ---
    b.mesh.position.y += Math.sin(t * 5 + b.mesh.userData.phase) * 0.15;
    b.mesh.rotation.z += 0.01 * Math.sin(t * 2 + b.mesh.userData.phase);
  });

  document.getElementById("timer").textContent = Math.ceil(timer);
  document.getElementById("hits").textContent = hitCount;

  // --- Szene rendern ---
  composer.render();
  requestAnimationFrame(animate);

  // --- Kamera langsam um Zentrum kreisen lassen ---
  camera.position.applyAxisAngle(new THREE.Vector3(0, 1, 0), dt * guiParams.orbitSpeed * Math.PI * 2);
  camera.lookAt(0, 0, 0);

  // --- Zielleine vom Zauberstab aus ausrichten ---
  const start = new THREE.Vector3();
  const dir = new THREE.Vector3();
  tip.getWorldPosition(start);
  tip.getWorldDirection(dir);
  const end = start.clone().add(dir.multiplyScalar(100));
  aimLine.geometry.setFromPoints([start, end]);
}