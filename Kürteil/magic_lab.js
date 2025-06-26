// --- GUI-Parameter definieren ---
const guiParams = {
  groundSpeed:        0.5,  // Umdrehungen pro Sekunde
  particleCount:    100,    // Partikel pro Explosion
  explosionStrength: 5,      // Skalierungsfaktor für Ausstoß-Geschwindigkeit
  orbitSpeed: 0.1,  // Umdrehungen pro Sekunde
  boxCount:          10, // Anzahl der Boxen in der Szene
  fireflyCount:    200,       // Anzahl der Glühwürmchen
  spawnRadius:      10,
};

const spells = {
  fireball: () => castFireball(),
  lightning: () => castLightning(),
  frost: () => castFrost()
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
gui.add(spells, 'fireball').name('Feuerball');
gui.add(spells, 'lightning').name('Blitz');
gui.add(spells, 'frost').name('Frost');

gui.__controllers.find(c=>c.property==='boxCount')
   .onChange(v => initBoxes());

const explosions = [];
let t0           = 0;
let scene, camera, renderer, controls;
let ground, tip;
let groundRotationSpeed = guiParams.groundSpeed; 
let wand;  
let wandAnim = { active: false, time: 0 };
let world, boxes = [];
let projectiles = [];
let composer, bloomPass; 
let fireflies;
let portal;

initScene();
initPhysics();
initGround();
initWand();
initClickHandler();
initBoxes();
initPostprocessing();
initFireflies();
initSkyboxEquirect();
initPortal();
requestAnimationFrame(animate);

function initScene() {
  // Szene & Renderer
  const canvas = document.querySelector('#c');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  // Szene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);

  // Licht hinzufügen
  scene.add(new THREE.AmbientLight(0x666666));               // sanftes Grundlicht
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
  dirLight.position.set(5, 10, 7);
  scene.add(dirLight);

  // Kamera
  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0,5,10);

  // Controls
  controls = new THREE.TrackballControls(camera, renderer.domElement);
  controls.staticMoving = true;

  // ===== Auf Fenster-Resize reagieren =====
  window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  controls.handleResize();
  });
}

function initPostprocessing() {
  // 1) RenderPass: rendere die Szene normal
  const renderPass = new THREE.RenderPass(scene, camera);

  // 2) UnrealBloomPass: Threshold, Strength, Radius
  bloomPass = new THREE.UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.5,   // strength
    0.4,   // radius
    0.85   // threshold
  );

  // direkt zum Bildschirm ausgeben:
  bloomPass.renderToScreen = true;

  // 3) Composer
  composer = new THREE.EffectComposer(renderer);
  composer.addPass(renderPass);
  composer.addPass(bloomPass);

  // Fenster-Resize auch zum Composer weiterreichen
  window.addEventListener('resize', () => {
    composer.setSize(window.innerWidth, window.innerHeight);
    bloomPass.setSize(window.innerWidth, window.innerHeight);
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

// ===== Magic-Circle Boden =====
function initGround(){
  const texLoader = new THREE.TextureLoader();
  const circleTex = texLoader.load('magic_circle.png');
  circleTex.wrapS = circleTex.wrapT = THREE.RepeatWrapping;
  circleTex.repeat.set(1, 1);

  const groundMat = new THREE.MeshBasicMaterial({
    map: circleTex,
    side: THREE.DoubleSide
  });
  ground = new THREE.Mesh(new THREE.PlaneGeometry(20, 20),groundMat);
  ground.rotation.x = -Math.PI / 2;  // flachlegen
  scene.add(ground);
}

// === Zauberstab ===
function initWand() {
  // Materialien für Stab und Spitze
  const stickMat = new THREE.MeshPhongMaterial({ color: 0x552200 });
  const tipMat   = new THREE.MeshPhongMaterial({
    color:     0xffaa00,
    emissive:  0x442200,
    emissiveIntensity: 10
  });

  // Geometrien: dünner Zylinder + kleine Kugel
  const stickGeo = new THREE.CylinderGeometry(0.05, 0.05, 4);
  const tipGeo   = new THREE.SphereGeometry(0.3, 16, 16);

  // Meshes erzeugen
  const stickMesh = new THREE.Mesh(stickGeo, stickMat);
  tip   = new THREE.Mesh(tipGeo, tipMat);

  // Positionierung: 
  //   - Stab so verschieben, dass er mit seinem Fuß im Ursprung steht
  //   - Spitze sitzt oben an der Stabspitze
  stickMesh.position.y = 2;    // halbe Stablänge
  tip.position.y   = 4.1;  // etwas oberhalb des Stabendes

  // In eine Gruppe packen (gemeinsam transformierbar)
  wand = new THREE.Group();
  wand.add(stickMesh, tip);
  scene.add(wand);
}

// ===== Würfel in der Szene (Physik-Körper + Mesh) =====
function initBoxes() {

  boxes.forEach(b => {
    scene.remove(b.mesh);
    world.removeBody(b.body);
  });
  boxes.length = 0; 

  const R = guiParams.spawnRadius;
  const boxGeo = new THREE.BoxGeometry(1,1,1);
  const boxMat = new THREE.MeshPhongMaterial({color: 0x88ccff, emissive: 0x222244, shininess: 50});
  boxes.forEach(b => {
    scene.remove(b.mesh);
    world.removeBody(b.body);
  });
  

  for (let i = 0; i < guiParams.boxCount; i++) {
    const mesh = new THREE.Mesh(boxGeo, boxMat);
    mesh.position.set(
      (Math.random() - .5) * 2*R,
       Math.random() * 5 + 1,           // Höhe
      (Math.random() - .5) * 2*R
    );
    scene.add(mesh);

    // Cannon.js‐Body
    const shape = new CANNON.Box(new CANNON.Vec3(0.5,0.5,0.5));
    const body  = new CANNON.Body({ mass: 1 });
    body.addShape(shape);
    body.position.set(mesh.position.x, mesh.position.y, mesh.position.z);
    world.addBody(body);

    boxes.push({ mesh, body });
  }
}

function initFireflies() {
  if (fireflies) scene.remove(fireflies);
  const count = guiParams.fireflyCount;
  const R     = guiParams.spawnRadius;
  // Positions-Array
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    pos[3*i  ] = (Math.random() - .5) * 2*R;
    pos[3*i+1] = Math.random() * 5 + 1;     // Höhe
    pos[3*i+2] = (Math.random() - .5) * 2*R;
  }
  const geom = new THREE.BufferGeometry();
  geom.addAttribute('position', new THREE.BufferAttribute(pos, 3));

  const mat = new THREE.PointsMaterial({
    color: 0xffff66,
    size: 0.1,
    transparent: true,
    opacity: 0.8,
    sizeAttenuation: true
  });

  fireflies = new THREE.Points(geom, mat);
  scene.add(fireflies);
}
function initPortal() {
  // 1) Geometrie: ein flacher Kreis
  const geom = new THREE.CircleGeometry(3, 64);

  // 2) ShaderMaterial
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(0x66ccff) }
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
      }
    `,
    fragmentShader: `
      // Simple 2D noise (you kannst hier auch 'classic' noise packen)
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float noise(vec2 p){
        vec2 i = floor(p);
        vec2 f = fract(p);
        float a = hash(i);
        float b = hash(i+vec2(1.0,0.0));
        float c = hash(i+vec2(0.0,1.0));
        float d = hash(i+vec2(1.0,1.0));
        vec2 u = f*f*(3.0-2.0*f);
        return mix(a,b,u.x) + (c-a)*u.y*(1.0-u.x) + (d-b)*u.x*u.y;
      }

      uniform float uTime;
      uniform vec3 uColor;
      varying vec2 vUv;
      void main(){
        // verwirbelte Koordinate
        vec2 uv = vUv*2.0 - 1.0;
        float n = noise(uv*3.0 + uTime*0.5);
        float alpha = smoothstep(0.2,0.8, n);
        gl_FragColor = vec4(uColor * (0.5 + 0.5*n), alpha*0.6);
      }
    `
  });

  portal = new THREE.Mesh(geom, mat);
  portal.rotation.x = -Math.PI/2;
  portal.position.y = 0.01;  // knapp über dem Boden
  scene.add(portal);
}


function initClickHandler() {
 window.addEventListener('keydown', (ev) => {
  console.log('Taste gedrückt:', ev.key);
  if (ev.key.toLowerCase() === 'e') {
    const center = new THREE.Vector3();
    tip.getWorldPosition(center);
    createExplosion(center);

    wandAnim.active = true;
    wandAnim.time = 0;
    }
  });

  window.addEventListener('keydown', ev => {
  if (ev.code === 'Space') {
    shootBall();
  }
});
}

// ===== Explosionserzeuger =====
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

function shootBall() {
  // 1.1 Geometrie & Material für den Ball
  const ballGeo = new THREE.SphereGeometry(0.2, 16, 16);
  const ballMat = new THREE.MeshPhongMaterial({ color: 0xffdd33, emissive: 0x552200, emissiveIntensity: 2 });
  const ball   = new THREE.Mesh(ballGeo, ballMat);

  // 1.2 Startposition = Spitze des Zauberstabs
  const start = new THREE.Vector3();
  tip.getWorldPosition(start);
  ball.position.copy(start);

  scene.add(ball);

  // 1.3 Flugrichtung = Wand-Ausgangsrichtung
  const dir = new THREE.Vector3();
  tip.getWorldDirection(dir);        // lokal -Z ist default, ggf negate
  dir.normalize();

  const speed = 10;                  // Einheiten pro Sekunde
  const velocity = dir.multiplyScalar(speed);

  projectiles.push({ mesh: ball, velocity, life: 0 });
}

function createColoredParticles(center, color) {
  const count = guiParams.particleCount;
  const geo   = new THREE.BufferGeometry();
  const pos   = new Float32Array(count * 3);
  const vels  = [];

  for (let i = 0; i < count; i++) {
    pos[3*i  ] = center.x;
    pos[3*i+1] = center.y;
    pos[3*i+2] = center.z;
    // zufällige Richtung
    vels.push(
      new THREE.Vector3(
        Math.random()*2 -1,
        Math.random()*2 -1,
        Math.random()*2 -1
      ).normalize().multiplyScalar(guiParams.explosionStrength * 4)
    );
  }
  
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    color,
    size: 0.3,
    sizeAttenuation: true
  });
  const pts = new THREE.Points(geo, mat);
  pts.userData = { vels, age: 0 };
  scene.add(pts);
  explosions.push(pts);
}

function castFireball() {
  const ballGeo = new THREE.SphereGeometry(0.3, 16, 16);
  const ballMat = new THREE.MeshBasicMaterial({ color: 0xff5522, emissive: 0x442200 });
  const ball    = new THREE.Mesh(ballGeo, ballMat);

  // Start an der Spitze des Stabes
  tip.getWorldPosition(ball.position);
  scene.add(ball);

  // Flugrichtung
  const dir = new THREE.Vector3();
  tip.getWorldDirection(dir).normalize();
  const speed = 8;

  // Füge in projectiles ein, mit maxLife und onDie-Callback
  projectiles.push({
    mesh:    ball,
    velocity: dir.multiplyScalar(speed),
    life:     0,
    maxLife:  1.5, // nach 1.5s wird er automatisch ausgelöst
    onDie:    pos => createColoredParticles(pos, 0xff5522)
  });
}

function castLightning() {
  // Baue Blitzlinie
  const start = new THREE.Vector3();
  tip.getWorldPosition(start);
  const dir   = new THREE.Vector3();
  tip.getWorldDirection(dir).normalize();
  const end   = start.clone().add(dir.multiplyScalar(8));

  const boltGeo = new THREE.BufferGeometry().setFromPoints([ start, end ]);
  const boltMat = new THREE.LineBasicMaterial({ color: 0x99eeff });
  const bolt    = new THREE.Line(boltGeo, boltMat);
  scene.add(bolt);

  // nach 100ms löschen und Partikel erzeugen
  setTimeout(() => {
    scene.remove(bolt);
    createColoredParticles(end, 0x99eeff);
  }, 100);
}

function castFrost() {
  const circle = new THREE.Mesh(
    new THREE.CircleGeometry(2.5, 32),
    new THREE.MeshBasicMaterial({ color: 0x99ddff, transparent: true, opacity: 0.5 })
  );
  // position auf Boden, unterhalb der Spitze
  const pos = new THREE.Vector3();
  tip.getWorldPosition(pos);
  circle.position.set(pos.x, 0.01, pos.z);
  circle.rotation.x = -Math.PI/2;
  scene.add(circle);

  setTimeout(() => scene.remove(circle), 500);
  createColoredParticles(pos, 0xffffff);
}


function initSkyboxEquirect() {
  const loader = new THREE.TextureLoader();
  loader.load(
    'milky_way_skybox_hdri_panorama/textures/material_emissive.png',
    tex => {
      // damit es als Rundum-Himmel funktioniert:
      tex.mapping = THREE.EquirectangularReflectionMapping;
      // oder THREE.EquirectangularRefractionMapping je nach Geschmack

      // als Hintergrund:
      scene.background = tex;
      // optional auch als Umgebungsbeleuchtung:
      // scene.environment = tex;
      console.log('✅ Equirect-Skybox geladen');
    },
    undefined,
    err => console.error('❌ Skybox-Fehler:', err)
  );
}

// ===== Haupt-Animate-Loop =====
function animate(time) {
  const dt = (time - t0) * 0.001;
  t0 = time;

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
    
  camera.position.applyAxisAngle(
    new THREE.Vector3(0,1,0),
    dt * guiParams.orbitSpeed * Math.PI * 2    // in Radians pro Sekunde
  );

  // Immer auf den Ursprung schauen
  camera.lookAt(0,0,0);

  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    p.mesh.position.addScaledVector(p.velocity, dt);
    p.life += dt;
    // wenn überschritten…
    if (p.life > p.maxLife) {
      // rufe onDie (Explosion) auf
      if (p.onDie) p.onDie(p.mesh.position.clone());
      scene.remove(p.mesh);
      projectiles.splice(i, 1);
    }
  }

  // 1) Kamera-Controls
  controls.update();

  // 2) Boden drehen
  ground.rotation.z += dt * groundRotationSpeed;

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

    if (fireflies) {
      const arr = fireflies.geometry.attributes.position.array;
      // z.B. jedes Frame leicht vertikal oszillieren lassen
      for (let i = 1; i < arr.length; i += 3) {
        arr[i] += Math.sin(time * 0.001 + i) * 0.0001;
      }
      fireflies.geometry.attributes.position.needsUpdate = true;
    }

    if (portal) portal.material.uniforms.uTime.value += dt;

    // --- Physics ---
    world.step(1/60, dt, 3);
    // Würfel‐Meshes mit Bodies synchronisieren
    boxes.forEach(b => {
      b.mesh.position.copy(b.body.position);
      b.mesh.quaternion.copy(b.body.quaternion);
    });

    composer.render();
    requestAnimationFrame(animate);
}
