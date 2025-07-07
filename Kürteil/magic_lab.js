// ————————————————— GUI & globale Variablen —————————————————
const guiParams = {
  groundSpeed:        0.5,
  particleCount:    100,
  explosionStrength: 5,
  orbitSpeed:       0.1,
  boxCount:         10,
  fireflyCount:    200,
  spawnRadius:     10,
  targetCount:    5,
  targetDistance: 30, // neu: Distanz der Targets
  coneAngle:      Math.PI/3
};

const spells = {
  Feuerball:  () => castFireball(),
  Blitz:      () => castLightning(),
  Frost:      () => castFrost()
};

const gui = new dat.GUI();
gui.add(guiParams, 'groundSpeed',        0,   2   ).name('Boden-Speed').onChange(v => groundRotationSpeed = v);
gui.add(guiParams, 'particleCount',     10,  500, 1 ).name('Partikelzahl');
gui.add(guiParams, 'explosionStrength',  1,   20  ).name('Stärke Puls');
gui.add(guiParams, 'orbitSpeed', 0, 2).name('Orbit Speed');
gui.add(guiParams, 'boxCount',         0,  100, 1 ).name('Anzahl Boxen');
gui.add(guiParams, 'fireflyCount',       0, 1000, 1 )
   .name('Anzahl Fireflies')
   .onChange(v => initFireflies());
gui.add(guiParams, 'spawnRadius',        1,   50   ).name('Spawn-Radius');
gui.add(guiParams, 'targetCount',    1, 20, 1).name('Anzahl Ziele').onChange(initTargets);
gui.add(guiParams, 'targetDistance', 10, 100, 1).name('Ziel‐Distanz').onChange(initTargets);
gui.add(spells, 'Feuerball').name('Feuerball');
gui.add(spells, 'Blitz'    ).name('Blitz');
gui.add(spells, 'Frost'    ).name('Frost');

gui.__controllers.find(c=>c.property==='boxCount')
   .onChange(v => initBoxes());

let t0           = 0;
let scene, camera, renderer, controls;
let ground, tip, wand;
let composer, bloomPass, fireflies, portal;
let motes, moteSpeeds;
let world, boxes = [], explosions = [], projectiles = [];
let groundRotationSpeed = guiParams.groundSpeed; 
let wandAnim = { active: false, time: 0 };
let targets      = [];
let score        = 0;
let timeLeft     = 60;    // Sekunden
let gameActive   = true;

initScene();
initPhysics();
initGround();
initWand();
initInput();
initBoxes();
initPostprocessing();
initFireflies();
initSkyboxEquirect();
initTargets();
requestAnimationFrame(animate);

// ————————————————— Functions —————————————————
function initScene() {
  renderer = new THREE.WebGLRenderer({ canvas: document.querySelector('#c'), antialias: true });
  renderer.setSize(innerWidth, innerHeight);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  scene.add(new THREE.AmbientLight(0x666666));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
  dirLight.position.set(5,10,7);
  scene.add(dirLight);

  camera = new THREE.PerspectiveCamera(60, innerWidth/innerHeight, 0.1, 100);
  camera.position.set(0,5,10);

  controls = new THREE.TrackballControls(camera, renderer.domElement);
  controls.staticMoving = true;

  window.addEventListener('resize', () => {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth/innerHeight;
    camera.updateProjectionMatrix();
    controls.handleResize();
    composer.setSize(innerWidth, innerHeight);
    bloomPass.setSize(innerWidth, innerHeight);
  });
}

function initPhysics() {
  world = new CANNON.World();
  world.gravity.set(0, 0, 0);
  world.broadphase = new CANNON.NaiveBroadphase();

  // Boden-Plane (mass=0 → static)
  const groundBody = new CANNON.Body({ mass: 0 });
  groundBody.addShape(new CANNON.Plane());
  groundBody.quaternion.setFromEuler(-Math.PI/2, 0, 0);
  world.addBody(groundBody);
}

function initPhysics() {
  world = new CANNON.World();
  world.gravity.set(0,0,0);
  world.broadphase = new CANNON.NaiveBroadphase();

  const groundBody = new CANNON.Body({ mass: 0 });
  groundBody.addShape(new CANNON.Plane());
  groundBody.quaternion.setFromEuler(-Math.PI/2, 0, 0);
  world.addBody(groundBody);
}

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

function initSkyboxEquirect() {
  new THREE.TextureLoader().load(
    'milky_way_skybox_hdri_panorama/textures/material_emissive.png',
    tex => {
      tex.mapping = THREE.EquirectangularReflectionMapping;
      scene.background = tex;
    }
  );
}

function initTargets() {
  // alte löschen
  targets.forEach(t => scene.remove(t.mesh));
  targets = [];

  const { targetCount, targetDistance, coneAngle } = guiParams;
  const upAxis = new THREE.Vector3(0,1,0);

  const geo = new THREE.SphereGeometry(0.5,12,12);
  const mat = new THREE.MeshPhongMaterial({ color: 0xff4444, emissive: 0x440000 });

  for (let i = 0; i < targetCount; i++) {
    // 1) Richtung aus Kamera‐Vorderseite plus Zufall im Kegel
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    const ang = (Math.random() - 0.5) * 2 * coneAngle;
    dir.applyAxisAngle(upAxis, ang).normalize();

    // 2) Spawn‐Position = Kamera + dir * Distanz + zufälliger Höhen‐Offset
    const pos = camera.position.clone()
      .add(dir.clone().multiplyScalar(targetDistance))
      .add(new THREE.Vector3(0, Math.random() * 3 + 1, 0));

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    scene.add(mesh);

    // einfache Drift
    const vel = new THREE.Vector3(
      (Math.random()-0.5)*0.2,
      0,
      (Math.random()-0.5)*0.2
    );
    targets.push({ mesh, vel });
  }
}

function initGround() {
  const tex = new THREE.TextureLoader().load('magic_circle.png');
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;

  ground = new THREE.Mesh(
    new THREE.PlaneGeometry(20,20),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide })
  );
  ground.rotation.x = -Math.PI/2;
  scene.add(ground);
}

function initWand() {
  const stickMat = new THREE.MeshPhongMaterial({ color: 0x552200 });
  const tipMat   = new THREE.MeshPhongMaterial({ color:0xffaa00, emissive:0x442200, emissiveIntensity:10 });

  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.05,0.05,4), stickMat);
  tip           = new THREE.Mesh(new THREE.SphereGeometry(0.3,16,16), tipMat);
  stick.position.y = 2;
  tip.position.y   = 4.1;

  wand = new THREE.Group();
  wand.add(stick, tip);
  scene.add(wand);
}

function initBoxes() {
  // alte Boxen entfernen
  boxes.forEach(b => { scene.remove(b.mesh); world.removeBody(b.body); });
  boxes.length = 0;

  const R = guiParams.spawnRadius;
  const geo = new THREE.BoxGeometry(1,1,1);
  const mat = new THREE.MeshPhongMaterial({ color:0x88ccff, emissive:0x222244, shininess:50 });

  for (let i=0; i<guiParams.boxCount; i++) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set((Math.random()-0.5)*2*R, Math.random()*5+1, (Math.random()-0.5)*2*R);
    scene.add(mesh);

    const shape = new CANNON.Box(new CANNON.Vec3(0.5,0.5,0.5));
    const body  = new CANNON.Body({ mass:1 });
    body.addShape(shape);
    body.position.copy(mesh.position);
    world.addBody(body);

    boxes.push({ mesh, body });
  }
}

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

function initInput() {
  window.addEventListener('keydown', ev => {
    if (ev.key.toLowerCase() === 'f') spells.Feuerball();
    if (ev.code === 'e')        spells.Lightning();
    if (ev.code === 'Space')        castFrost();  
  });
}

// ————————————————— Spells —————————————————
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
  // projiziere Explosion auf Bodenniveau Y=0.5
  const explosionPoint = new CANNON.Vec3(center.x, 0.5, center.z);

  boxes.forEach(b => {
    const bodyPos = b.body.position;
    const dist3d = bodyPos.distanceTo(new CANNON.Vec3(center.x, center.y, center.z));
    if (dist3d < radius) {
      // Richtung von Explosion zur Box
      const dirC = bodyPos.vsub(new CANNON.Vec3(center.x, center.y, center.z)).unit();
      // Y-Komponente sicher positiv machen
      dirC.y = Math.abs(dirC.y);
      // lineare Abnahme der Stärke
      const strength = (1 - dist3d / radius) * guiParams.explosionStrength * 10;
      b.body.applyImpulse(dirC.scale(strength), bodyPos);
    }
  });
}

function castFireball() {
  // Mesh erzeugen
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(0.3,16,16),
    new THREE.MeshBasicMaterial({ color:0xff5522, emissive:0x442200 })
  );

  // 1) Start am Tip des Stabes
  const start = new THREE.Vector3();
  tip.getWorldPosition(start);
  ball.position.copy(start);
  scene.add(ball);

  // 2) Flugrichtung: von dort aus in Kamerarichtung
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  dir.normalize();

  // 3) Speed & Lifetime
  const speed = 15;
  projectiles.push({
    mesh:     ball,
    velocity: dir.multiplyScalar(speed),
    life:     0,
    maxLife:  2
  });
}

function castLightning() {
  const start=new THREE.Vector3(), dir=new THREE.Vector3();
  tip.getWorldPosition(start); tip.getWorldDirection(dir).normalize();
  const end = start.clone().add(dir.multiplyScalar(8));

  const pts=[];
  for(let i=0;i<=12;i++){
    const p=start.clone().lerp(end,i/12);
    if(i>0&&i<12) p.add(new THREE.Vector3(
      (Math.random()-0.5)*0.3,
      (Math.random()-0.5)*0.3,
      (Math.random()-0.5)*0.3
    ));
    pts.push(p);
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const bolt = new THREE.Mesh(
    new THREE.TubeGeometry(curve,12,0.05,8,false),
    new THREE.MeshBasicMaterial({ color:0x99eeff, transparent:true, opacity:0.8 })
  );
  scene.add(bolt);
  setTimeout(()=>{
    scene.remove(bolt);
    createExplosion(end);
  },150);
}

function castFrost() {
  const pos=new THREE.Vector3();
  tip.getWorldPosition(pos);
  const circle=new THREE.Mesh(
    new THREE.CircleGeometry(2.5,32),
    new THREE.MeshBasicMaterial({ color:0x99ddff, transparent:true, opacity:0.5 })
  );
  circle.position.set(pos.x,0.01,pos.z);
  circle.rotation.x=-Math.PI/2;
  scene.add(circle);
  setTimeout(()=>scene.remove(circle),500);
}

function spawnSingleTarget() {
  const R = guiParams.spawnRadius;
  const geo = new THREE.SphereGeometry(0.4, 12, 12);
  const mat = new THREE.MeshPhongMaterial({ color: 0xff4444, emissive: 0x440000, shininess: 30 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(
    (Math.random() - 0.5) * 2 * R,
    1 + Math.random() * 4,
    (Math.random() - 0.5) * 2 * R
  );
  scene.add(mesh);
  const vel = new THREE.Vector3(
    (Math.random() - 0.5) * 0.5,
    0,
    (Math.random() - 0.5) * 0.5
  );
  targets.push({ mesh, vel });
}


// ===== Haupt-Animate-Loop =====
function animate(time) {
  const dt = (time - t0) * 0.001;
  t0 = time;

  if (gameActive) {
    // Timer runterticken
    timeLeft = Math.max(0, timeLeft - dt);
    if (timeLeft === 0) {
      gameActive = false;
      // hier könntest du ein „Game Over“ einblenden…
    }
  }

  // Targets bewegen
  targets.forEach(t => {
    t.mesh.position.addScaledVector(t.vel, dt);
    // bei Rand erreichen: einfach zurückdrehen
    const R = guiParams.spawnRadius;
    if (Math.abs(t.mesh.position.x) > R) t.vel.x *= -1;
    if (Math.abs(t.mesh.position.z) > R) t.vel.z *= -1;
  });

  // HUD updaten
  const hud = document.getElementById('hud');
  hud.textContent = `Score: ${score} – Time: ${timeLeft.toFixed(1)}s`;

  // → vor controls.update() einfügen:
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    // 3.1 Position aktualisieren
    p.mesh.position.addScaledVector(p.velocity, dt);
    p.life += dt;

    // 3.2 Aufschlag-Check: hier per Lebenszeit, könntest auch raycast nehmen
    if (p.life > 1.5) {  // nach 1.5 s explodiert der Ball
      // Explosion an aktueller Position
      createExplosion(p.mesh.position.clone());
      scene.remove(p.mesh);
      projectiles.splice(i, 1);
    }
  }
    
    // Orbit-Kamera
  camera.position.applyAxisAngle(new THREE.Vector3(0,1,0), dt*guiParams.orbitSpeed*Math.PI*2);
  camera.lookAt(0,0,0);

  controls.update();
  ground.rotation.z += dt*groundRotationSpeed;

  // 3) Explosionen updaten
  for (let i = explosions.length - 1; i >= 0; i--) {
    const p    = explosions[i];
    const posA = p.geometry.attributes.position;
    const vels = p.userData.vels;
    p.userData.age += dt;

    for (let j = 0; j < posA.count; j++) {
      posA.array[3*j  ] += vels[j].x * dt;
      posA.array[3*j+1] += vels[j].y * dt - 9.8 * dt * 0.2;
      posA.array[3*j+2] += vels[j].z * dt;
    }
      posA.needsUpdate = true;

      if (p.userData.age > 2) {
        scene.remove(p);
        explosions.splice(i, 1);
      }
  }

  // Fireflies leicht oszillieren
  if(fireflies){
    const arr=fireflies.geometry.attributes.position.array;
    for(let i=1;i<arr.length;i+=3) arr[i]+=Math.sin(time*0.001+i)*0.0001;
    fireflies.geometry.attributes.position.needsUpdate=true;
  }

  // Physik-Step
  world.step(1/60, dt, 3);
  boxes.forEach(b=>{
    b.mesh.position.copy(b.body.position);
    b.mesh.quaternion.copy(b.body.quaternion);
  });

  composer.render();
  requestAnimationFrame(animate);
}