// Sky dome with a sun or moon, drifting clouds and stars, in three moods.
// Also drives the scene's lights and fog so everything matches the time of day.
import * as THREE from 'three';
import { blobTexture, cloudTexture } from './textures.js';

export const SKIES = {
  day: {
    label: 'Day', top: 0x3f86dd, horizon: 0xc4e6f7, ground: 0x7fa2a8, fog: 0xc4e6f7, fogFar: 120,
    hemi: [0xe8f6ff, 0x4a5a2a, 1.6], sun: [0xfff0d2, 1.7], sunDir: [0.42, 0.82, 0.38], disc: 0xfff6d8, discSize: 26,
    cloud: 0xffffff, cloudOpacity: 0.95, stars: 0,
  },
  sunset: {
    label: 'Sunset', top: 0x27356f, horizon: 0xff9d5c, ground: 0x6a4a4a, fog: 0xeaa27a, fogFar: 100,
    hemi: [0xffc9a0, 0x3a3550, 1.15], sun: [0xff8a45, 1.5], sunDir: [-0.82, 0.2, -0.52], disc: 0xffb066, discSize: 38,
    cloud: 0xffb48a, cloudOpacity: 0.9, stars: 0.25,
  },
  night: {
    label: 'Night', top: 0x04060e, horizon: 0x18244a, ground: 0x0c1220, fog: 0x121a30, fogFar: 85,
    hemi: [0x8fa4ff, 0x141c26, 0.75], sun: [0xaac4ff, 0.7], sunDir: [0.3, 0.8, -0.52], disc: 0xe8eeff, discSize: 14,
    cloud: 0x3a4666, cloudOpacity: 0.55, stars: 1,
  },
};
export const SKY_ORDER = ['day', 'sunset', 'night'];

export class Sky {
  constructor(scene, hemi, sun) {
    this.scene = scene; this.hemi = hemi; this.sun = sun;
    this.group = new THREE.Group();
    scene.add(this.group);

    this.uniforms = { top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, ground: { value: new THREE.Color() } };
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(190, 24, 14),
      new THREE.ShaderMaterial({
        uniforms: this.uniforms, side: THREE.BackSide, depthWrite: false, fog: false,
        vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 ground; varying vec3 vDir;
          void main(){ float h = normalize(vDir).y;
            vec3 c = h > 0.0 ? mix(horizon, top, pow(h, 0.55)) : mix(horizon, ground, min(-h * 6.0, 1.0));
            gl_FragColor = vec4(c, 1.0);
            #include <colorspace_fragment>
          }`,
      }));
    dome.renderOrder = -10;
    this.group.add(dome);

    this.disc = new THREE.Sprite(new THREE.SpriteMaterial({ map: blobTexture(), fog: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending }));
    this.disc.renderOrder = -8;
    this.group.add(this.disc);

    // stars
    const pts = [];
    let seed = 3; const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 500; i++) {
      const a = r() * Math.PI * 2, y = 0.05 + r() * 0.95, rad = Math.sqrt(1 - y * y);
      pts.push(Math.cos(a) * rad * 180, y * 180, Math.sin(a) * rad * 180);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, depthWrite: false }));
    this.stars.renderOrder = -9;
    this.group.add(this.stars);

    // clouds
    this.cloudMat = new THREE.MeshBasicMaterial({ map: cloudTexture(), transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide });
    this.clouds = [];
    const cg = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < 16; i++) {
      const m = new THREE.Mesh(cg, this.cloudMat);
      const w = 40 + r() * 50;
      m.scale.set(w, w * 0.55, 1);
      m.rotation.x = -Math.PI / 2;
      m.position.set((r() - 0.5) * 320, 55 + r() * 25, (r() - 0.5) * 320);
      m.userData.speed = 0.6 + r() * 0.8;
      m.renderOrder = -7;
      this.group.add(m); this.clouds.push(m);
    }
    this.name = null;
    this.set('day');
  }

  set(name) {
    const p = SKIES[name];
    if (!p || name === this.name) return;
    this.name = name;
    this.uniforms.top.value.setHex(p.top);
    this.uniforms.horizon.value.setHex(p.horizon);
    this.uniforms.ground.value.setHex(p.ground);
    this.scene.background = new THREE.Color(p.fog);
    this.scene.fog.color.setHex(p.fog);
    this.scene.fog.far = p.fogFar;
    this.hemi.color.setHex(p.hemi[0]); this.hemi.groundColor.setHex(p.hemi[1]); this.hemi.intensity = p.hemi[2];
    this.sun.color.setHex(p.sun[0]); this.sun.intensity = p.sun[1];
    this.sun.position.fromArray(p.sunDir).multiplyScalar(30);
    this.disc.position.fromArray(p.sunDir).normalize().multiplyScalar(175);
    this.disc.scale.setScalar(p.discSize * 2);
    this.disc.material.color.setHex(p.disc);
    this.stars.material.opacity = p.stars; this.stars.visible = p.stars > 0;
    this.cloudMat.color.setHex(p.cloud); this.cloudMat.opacity = p.cloudOpacity;
  }

  /** Keep the sky centred on the viewer and drift the clouds. */
  update(dt, viewPos) {
    this.group.position.set(viewPos.x, 0, viewPos.z);
    for (const c of this.clouds) {
      c.position.x += c.userData.speed * dt;
      if (c.position.x > 170) c.position.x = -170;
    }
  }
}
