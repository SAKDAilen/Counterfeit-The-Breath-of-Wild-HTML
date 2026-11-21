/* ============================================================
 * BOTW Physics — tiny dependency-free rigid-body engine
 * ------------------------------------------------------------
 * Written for the Hyrule Adventure project.  It is deliberately
 * small: a fixed-step impulse solver with orientation, static
 * height-field contacts, cylinder obstacles, sphere/box bodies
 * and sleeping.  Everything is procedural and texture-free.
 *
 * Classic script (window.BOTWPhysics) so the game still runs
 * when main.html is opened through file://.
 * ============================================================ */
(function (global) {
  'use strict';

  const EPS = 1e-6;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

  function vec(x, y, z) { return { x: x || 0, y: y || 0, z: z || 0 }; }
  function copyVec(v) { return { x: v.x, y: v.y, z: v.z }; }
  function add(a, b) { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
  function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
  function scale(a, s) { return { x: a.x * s, y: a.y * s, z: a.z * s }; }
  function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
  function cross(a, b) {
    return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
  }
  function length(a) { return Math.sqrt(dot(a, a)); }
  function normalize(a) {
    const l = length(a);
    return l > EPS ? scale(a, 1 / l) : vec(0, 1, 0);
  }
  function lerp(a, b, t) { return a + (b - a) * t; }

  // ---- quaternion helpers (x,y,z,w) ----
  function quatIdentity() { return { x: 0, y: 0, z: 0, w: 1 }; }
  function quatFromEuler(x, y, z) {
    const cx = Math.cos(x / 2), sx = Math.sin(x / 2);
    const cy = Math.cos(y / 2), sy = Math.sin(y / 2);
    const cz = Math.cos(z / 2), sz = Math.sin(z / 2);
    return {
      x: sx * cy * cz + cx * sy * sz,
      y: cx * sy * cz - sx * cy * sz,
      z: cx * cy * sz + sx * sy * cz,
      w: cx * cy * cz - sx * sy * sz,
    };
  }
  function quatMul(a, b) {
    return {
      x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
      y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
      z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
      w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    };
  }
  function quatNormalize(q) {
    const l = Math.hypot(q.x, q.y, q.z, q.w) || 1;
    q.x /= l; q.y /= l; q.z /= l; q.w /= l;
    return q;
  }
  function quatRotate(q, v) {
    // v' = v + 2 * cross(q.xyz, cross(q.xyz, v) + q.w * v)
    const qv = { x: q.x, y: q.y, z: q.z };
    const t = scale(cross(qv, v), 2);
    return add(add(v, scale(t, q.w)), cross(qv, t));
  }
  function quatInvRotate(q, v) {
    return quatRotate({ x: -q.x, y: -q.y, z: -q.z, w: q.w }, v);
  }
  function integrateQuat(q, omega, dt) {
    const dq = quatMul({ x: omega.x, y: omega.y, z: omega.z, w: 0 }, q);
    q.x += dq.x * 0.5 * dt;
    q.y += dq.y * 0.5 * dt;
    q.z += dq.z * 0.5 * dt;
    q.w += dq.w * 0.5 * dt;
    return quatNormalize(q);
  }

  // ============================================================
  // Rigid body
  // ============================================================
  let NEXT_BODY_ID = 1;
  class Body {
    constructor(opts) {
      opts = opts || {};
      this.id = NEXT_BODY_ID++;
      this.label = opts.label || 'prop';
      this.shape = opts.shape || 'box'; // 'box' | 'sphere'
      this.half = opts.half ? copyVec(opts.half) : vec(0.4, 0.4, 0.4);
      this.radius = opts.radius || Math.max(this.half.x, this.half.y, this.half.z);
      this.boundRadius = this.shape === 'sphere' ? this.radius : Math.hypot(this.half.x, this.half.y, this.half.z);
      this.mass = Math.max(0.01, opts.mass || 1);
      this.invMass = 1 / this.mass;
      this.position = opts.position ? copyVec(opts.position) : vec();
      this.velocity = opts.velocity ? copyVec(opts.velocity) : vec();
      this.omega = opts.omega ? copyVec(opts.omega) : vec();
      this.q = opts.q ? quatNormalize(copyVec(opts.q)) : (opts.rotation ? quatFromEuler(opts.rotation.x, opts.rotation.y, opts.rotation.z) : quatIdentity());
      this.restitution = opts.restitution !== undefined ? opts.restitution : 0.16;
      this.friction = opts.friction !== undefined ? opts.friction : 0.72;
      this.linearDamping = opts.linearDamping !== undefined ? opts.linearDamping : 0.18;
      this.angularDamping = opts.angularDamping !== undefined ? opts.angularDamping : 0.34;
      this.gravityScale = opts.gravityScale !== undefined ? opts.gravityScale : 1;
      this.sleeping = !!opts.sleeping;
      this.sleepTimer = 0;
      this.started = false;
      this.alive = true;
      this.userData = opts.userData || {};
      this.onSleep = opts.onSleep || null;
      // diagonal inertia tensor for a solid box (full extents = 2 * half)
      const hx = this.half.x, hy = this.half.y, hz = this.half.z;
      const k = this.mass / 3; // (1/12 m (a²+b²)) with a=2h => 1/3 m (h²...)
      this.inertia = this.shape === 'sphere'
        ? { x: 0.4 * this.mass * this.radius * this.radius, y: 0.4 * this.mass * this.radius * this.radius, z: 0.4 * this.mass * this.radius * this.radius }
        : { x: k * (hy * hy + hz * hz), y: k * (hx * hx + hz * hz), z: k * (hx * hx + hy * hy) };
      this.invInertia = { x: 1 / Math.max(EPS, this.inertia.x), y: 1 / Math.max(EPS, this.inertia.y), z: 1 / Math.max(EPS, this.inertia.z) };
      this.rolling = !!opts.rolling;
      this.canBreak = !!opts.canBreak;
      this.broken = false;
    }

    wake() {
      if (this.sleeping) {
        this.sleeping = false;
        this.sleepTimer = 0;
      }
    }

    applyImpulse(impulse, point) {
      if (!this.alive) return;
      this.wake();
      this.velocity.x += impulse.x * this.invMass;
      this.velocity.y += impulse.y * this.invMass;
      this.velocity.z += impulse.z * this.invMass;
      if (point) {
        const r = sub(point, this.position);
        const torque = cross(r, impulse);
        this._applyAngularImpulse(torque);
      }
    }

    applyForce(force) {
      this.wake();
      this.velocity.x += force.x * this.invMass * (1 / 60);
      this.velocity.y += force.y * this.invMass * (1 / 60);
      this.velocity.z += force.z * this.invMass * (1 / 60);
    }

    _applyAngularImpulse(torque) {
      const local = quatInvRotate(this.q, torque);
      const outLocal = vec(local.x * this.invInertia.x, local.y * this.invInertia.y, local.z * this.invInertia.z);
      const out = quatRotate(this.q, outLocal);
      this.omega.x += out.x;
      this.omega.y += out.y;
      this.omega.z += out.z;
    }

    _inertiaMultiply(v) {
      const local = quatInvRotate(this.q, v);
      const outLocal = vec(local.x * this.invInertia.x, local.y * this.invInertia.y, local.z * this.invInertia.z);
      return quatRotate(this.q, outLocal);
    }

    worldCorners() {
      const out = [];
      const h = this.half;
      for (let sx = -1; sx <= 1; sx += 2)
        for (let sy = -1; sy <= 1; sy += 2)
          for (let sz = -1; sz <= 1; sz += 2) {
            const local = vec(sx * h.x, sy * h.y, sz * h.z);
            out.push(add(this.position, quatRotate(this.q, local)));
          }
      return out;
    }

    velocityAt(point) {
      return add(this.velocity, cross(this.omega, sub(point, this.position)));
    }
  }

  // ============================================================
  // Contact
  // ============================================================
  function makeContact(bodyA, bodyB, point, normal, penetration, opts) {
    return {
      a: bodyA, b: bodyB, point: copyVec(point), normal: copyVec(normal),
      penetration: penetration || 0,
      restitution: opts && opts.restitution !== undefined ? opts.restitution : 0.15,
      friction: opts && opts.friction !== undefined ? opts.friction : 0.7,
      normalImpulse: 0,
      tangentImpulse: 0,
    };
  }

  // ============================================================
  // World
  // ============================================================
  class World {
    constructor(opts) {
      opts = opts || {};
      this.gravity = opts.gravity !== undefined ? opts.gravity : -26;
      this.bodies = [];
      this.staticCylinders = [];
      this.terrainHeight = opts.terrainHeight || (() => 0);
      this.onImpact = opts.onImpact || null;
      this.fixedStep = opts.fixedStep || 1 / 90;
      this.maxSubSteps = opts.maxSubSteps || 3;
      this.accumulator = 0;
      this.iterationCount = opts.iterations || 6;
      this.time = 0;
      this._contacts = [];
      this._terrainNormalCache = new Map();
    }

    addBody(opts) {
      const b = new Body(opts);
      this.bodies.push(b);
      return b;
    }

    removeBody(b) {
      if (!b) return;
      b.alive = false;
      const i = this.bodies.indexOf(b);
      if (i >= 0) this.bodies.splice(i, 1);
    }

    addCylinder(x, z, radius, bottom, top, opts) {
      this.staticCylinders.push({
        x: x, z: z, radius: radius, bottom: bottom,
        top: top !== undefined ? top : (bottom + radius * 2),
        friction: opts && opts.friction !== undefined ? opts.friction : 0.65,
        restitution: opts && opts.restitution !== undefined ? opts.restitution : 0.12,
      });
    }

    clearBodies() { this.bodies.length = 0; }

    terrainNormal(x, z) {
      const e = 0.55;
      const dx = (this.terrainHeight(x + e, z) - this.terrainHeight(x - e, z)) / (2 * e);
      const dz = (this.terrainHeight(x, z + e) - this.terrainHeight(x, z - e)) / (2 * e);
      return normalize(vec(-dx, 1, -dz));
    }

    step(dt) {
      if (!(dt > 0)) return;
      dt = Math.min(dt, 0.1);
      this.accumulator += dt;
      let steps = 0;
      while (this.accumulator >= this.fixedStep && steps < this.maxSubSteps) {
        this._substep(this.fixedStep);
        this.accumulator -= this.fixedStep;
        steps++;
      }
      if (steps === this.maxSubSteps) this.accumulator = 0;
    }

    _substep(dt) {
      this.time += dt;
      const bodies = this.bodies;
      this._contacts.length = 0;

      // --- integrate velocities ---
      for (const b of bodies) {
        if (!b.alive || b.sleeping) continue;
        b.velocity.y += this.gravity * b.gravityScale * dt;
        const ld = Math.exp(-b.linearDamping * dt);
        b.velocity.x *= ld; b.velocity.y *= ld; b.velocity.z *= ld;
        const ad = Math.exp(-b.angularDamping * dt);
        b.omega.x *= ad; b.omega.y *= ad; b.omega.z *= ad;
        const sp = length(b.velocity);
        if (sp > 48) { const s = 48 / sp; b.velocity.x *= s; b.velocity.y *= s; b.velocity.z *= s; }
        const asp = length(b.omega);
        if (asp > 26) { const s = 26 / asp; b.omega.x *= s; b.omega.y *= s; b.omega.z *= s; }
      }

      // --- integrate positions ---
      for (const b of bodies) {
        if (!b.alive || b.sleeping) continue;
        b._touchedGround = false;
        b.position.x += b.velocity.x * dt;
        b.position.y += b.velocity.y * dt;
        b.position.z += b.velocity.z * dt;
        integrateQuat(b.q, b.omega, dt);
      }

      // --- collisions vs height field / static cylinders / each other ---
      for (const b of bodies) {
        if (!b.alive || b.sleeping) continue;
        this._terrainContacts(b);
        this._cylinderContacts(b);
      }
      this._bodyContacts();

      // --- solve contacts ---
      for (let it = 0; it < this.iterationCount; it++) {
        for (const c of this._contacts) this._solveContact(c, dt, it === 0);
      }

      // --- positional correction / sleeping ---
      for (const b of bodies) {
        if (!b.alive || b.sleeping) continue;
        // hard clamp below terrain for fully tunnelled spheres/boxes
        const highest = b.shape === 'sphere'
          ? this.terrainHeight(b.position.x, b.position.z) + b.radius
          : this._highestGroundUnderBox(b);
        if (b.position.y < highest - 0.65) {
          const n = this.terrainNormal(b.position.x, b.position.z);
          b.position.y = highest - 0.65;
          const vn = dot(b.velocity, n);
          if (vn < 0) b.velocity = sub(b.velocity, scale(n, vn * 1.1));
        }
        const lin = length(b.velocity);
        const ang = length(b.omega);
        const horiz = Math.hypot(b.velocity.x, b.velocity.z);
        b._groundGrace = b._touchedGround ? 0.30 : Math.max(0, (b._groundGrace || 0) - dt);
        const supported = b._groundGrace > 0;
        if (supported && horiz < 0.28 && Math.abs(b.velocity.y) < 0.9 && ang < 0.75) {
          b.sleepTimer += dt;
          if (b.sleepTimer > 0.55) {
            b.sleeping = true;
            b.velocity.x = b.velocity.y = b.velocity.z = 0;
            b.omega.x = b.omega.y = b.omega.z = 0;
            if (b.onSleep) b.onSleep(b);
          }
        } else b.sleepTimer = Math.max(0, b.sleepTimer - dt * 0.55);
        if (supported && lin < 0.55) {
          // resting friction / contact jitter damping
          b.velocity.y *= 0.72;
          b.omega.x *= 0.82; b.omega.z *= 0.82;
        }
        if (!isFinite(b.position.x) || !isFinite(b.position.y) || !isFinite(b.position.z)) {
          b.position.x = b.position.y = b.position.z = 0;
          b.velocity.x = b.velocity.y = b.velocity.z = 0;
        }
      }
    }

    _terrainContacts(b) {
      const points = [];
      if (b.shape === 'sphere') {
        const g = this.terrainHeight(b.position.x, b.position.z);
        const n = this.terrainNormal(b.position.x, b.position.z);
        const planeDist = (b.position.y - g) * n.y;
        if (planeDist < b.radius) {
          const point = vec(b.position.x - n.x * b.radius, b.position.y - n.y * b.radius, b.position.z - n.z * b.radius);
          points.push({ point: point, normal: n, penetration: b.radius - planeDist });
        }
      } else {
        const cs = b.worldCorners();
        for (const p of cs) {
          const g = this.terrainHeight(p.x, p.z);
          if (p.y < g + 0.015) {
            const n = this.terrainNormal(p.x, p.z);
            const penetration = (g - p.y) * n.y;
            points.push({ point: p, normal: n, penetration: Math.max(0.002, penetration) });
          }
        }
        if (points.length === 0) {
          const g = this.terrainHeight(b.position.x, b.position.z);
          if (b.position.y - b.half.y < g) {
            const n = this.terrainNormal(b.position.x, b.position.z);
            points.push({ point: vec(b.position.x, g, b.position.z), normal: n, penetration: g - (b.position.y - b.half.y) });
          }
        }
      }
      if (points.length) b._touchedGround = true;
      for (const p of points) this._addContact(makeContact(b, null, p.point, p.normal, p.penetration, { restitution: b.restitution * 0.6, friction: b.friction }));
    }

    _cylinderContacts(b) {
      if (!this.staticCylinders.length) return;
      for (const c of this.staticCylinders) {
        const y = b.position.y;
        if (y + b.boundRadius < c.bottom - 0.2 || y - b.boundRadius > c.top + 0.2) continue;
        const dx = b.position.x - c.x, dz = b.position.z - c.z;
        const d = Math.hypot(dx, dz);
        const minD = c.radius + (b.shape === 'sphere' ? b.radius : Math.min(b.half.x, b.half.z) * 0.72);
        if (d < minD && d > EPS) {
          const n = vec(dx / d, 0, dz / d);
          const point = vec(c.x + n.x * c.radius, y, c.z + n.z * c.radius);
          this._addContact(makeContact(b, null, point, n, minD - d, { restitution: c.restitution, friction: c.friction }));
        }
      }
    }

    _bodyContacts() {
      const bodies = this.bodies;
      for (let i = 0; i < bodies.length; i++) {
        const a = bodies[i];
        if (!a.alive) continue;
        for (let j = i + 1; j < bodies.length; j++) {
          const b = bodies[j];
          if (!b.alive) continue;
          if (a.sleeping && b.sleeping) continue;
          const delta = sub(b.position, a.position);
          const dist = length(delta);
          const minD = a.boundRadius + b.boundRadius;
          if (dist >= minD || dist < EPS) continue;
          const n = scale(delta, 1 / dist);
          const point = add(a.position, scale(n, a.boundRadius - (minD - dist) * 0.5));
          this._addContact(makeContact(a, b, point, n, minD - dist, { restitution: Math.min(a.restitution, b.restitution), friction: (a.friction + b.friction) * 0.5 }));
          // wake a sleeping body hit by a moving one
          if (a.sleeping && length(b.velocity) > 0.8) a.wake();
          if (b.sleeping && length(a.velocity) > 0.8) b.wake();
        }
      }
    }

    _addContact(c) {
      this._contacts.push(c);
    }

    _solveContact(c, dt, firstIteration) {
      const a = c.a, b = c.b;
      const n = c.normal;
      const ra = sub(c.point, a.position);
      const rb = b ? sub(c.point, b.position) : null;

      // positional drift correction
      const corr = Math.min(c.penetration, 0.10) * 0.11;
      if (!a.sleeping) {
        a.position.x += n.x * corr; a.position.y += n.y * corr; a.position.z += n.z * corr;
      }
      if (b && !b.sleeping) {
        b.position.x -= n.x * corr; b.position.y -= n.y * corr; b.position.z -= n.z * corr;
      }

      const va = a.velocityAt(c.point);
      const vb = b ? b.velocityAt(c.point) : vec();
      const rv = sub(va, vb);
      const vn = dot(rv, n);
      if (vn > 0) return;

      // effective mass along n
      let invMassTerm = a.invMass;
      const ta = cross(cross(a._inertiaMultiply(cross(ra, n)), ra), n);
      invMassTerm += dot(n, cross(a._inertiaMultiply(cross(ra, n)), ra));
      if (b) {
        invMassTerm += b.invMass;
        invMassTerm += dot(n, cross(b._inertiaMultiply(cross(rb, n)), rb));
      }
      if (invMassTerm < EPS) return;

      // restitution only when hitting hard enough
      const targetBounce = vn < -1.4 ? -c.restitution * vn : 0;
      let j = (-(1) * vn + targetBounce) / invMassTerm;
      j = Math.max(0, j);
      const impulse = scale(n, j);
      if (!a.sleeping) a.applyImpulse(impulse, c.point);
      if (b && !b.sleeping) b.applyImpulse(scale(impulse, -1), c.point);
      c.normalImpulse += j;

      // friction (Coulomb, tangent of relative velocity)
      const va2 = a.velocityAt(c.point);
      const vb2 = b ? b.velocityAt(c.point) : vec();
      let tangent = sub(sub(va2, vb2), scale(n, dot(sub(va2, vb2), n)));
      const tl = length(tangent);
      if (tl > 1e-4) {
        tangent = scale(tangent, 1 / tl);
        let tMass = a.invMass + (b ? b.invMass : 0);
        tMass += dot(tangent, cross(a._inertiaMultiply(cross(ra, tangent)), ra));
        if (b) tMass += dot(tangent, cross(b._inertiaMultiply(cross(rb, tangent)), rb));
        if (tMass > EPS) {
          let jt = -tl / tMass;
          const maxF = c.friction * Math.max(j, c.normalImpulse * 0.35);
          jt = clamp(jt, -maxF, maxF);
          const fImp = scale(tangent, jt);
          if (!a.sleeping) a.applyImpulse(fImp, c.point);
          if (b && !b.sleeping) b.applyImpulse(scale(fImp, -1), c.point);
        }
      }

      if (this.onImpact && firstIteration && c.normalImpulse > 9) {
        try { this.onImpact(a, b, Math.abs(vn), c.point, n); } catch (e) {}
      }
    }

    _highestGroundUnderBox(b) {
      const cs = b.worldCorners();
      let maxLift = -Infinity;
      for (const p of cs) {
        const g = this.terrainHeight(p.x, p.z);
        if (g + 0.02 - p.y > maxLift) maxLift = g + 0.02 - p.y;
      }
      if (maxLift === -Infinity) return b.position.y;
      return b.position.y + maxLift - 0.02;
    }

    querySphere(center, radius) {
      const out = [];
      for (const b of this.bodies) {
        if (!b.alive) continue;
        if (length(sub(b.position, center)) <= radius + b.boundRadius) out.push(b);
      }
      return out;
    }

    applyRadialImpulse(center, radius, strength, lift) {
      let hits = 0;
      for (const b of this.bodies) {
        if (!b.alive) continue;
        const d = sub(b.position, center);
        const dist = length(d);
        if (dist > radius) continue;
        const fall = 1 - dist / Math.max(radius, EPS);
        const dir = normalize(vec(d.x, d.y + (lift !== undefined ? lift : 0.55), d.z));
        const imp = scale(dir, strength * fall * b.mass);
        b.applyImpulse(imp, add(b.position, vec(0, -b.boundRadius * 0.3, 0)));
        b.omega.x += (Math.random() - 0.5) * 4 * fall;
        b.omega.z += (Math.random() - 0.5) * 4 * fall;
        hits++;
      }
      return hits;
    }

    raycast(origin, dir, maxDist) {
      const d = normalize(dir);
      let best = { hit: false, dist: maxDist, point: null, body: null };
      // sample height field
      const steps = Math.ceil(maxDist / 0.45);
      for (let i = 1; i <= steps; i++) {
        const t = maxDist * i / steps;
        const p = add(origin, scale(d, t));
        if (p.y <= this.terrainHeight(p.x, p.z)) {
          best.hit = true; best.dist = t; best.point = p; best.body = null;
          break;
        }
      }
      for (const b of this.bodies) {
        if (!b.alive) continue;
        const oc = sub(b.position, origin);
        const tca = dot(oc, d);
        if (tca < 0) continue;
        const d2 = dot(oc, oc) - tca * tca;
        const r2 = b.boundRadius * b.boundRadius;
        if (d2 > r2) continue;
        const thc = Math.sqrt(Math.max(0, r2 - d2));
        const t = tca - thc;
        if (t > 0 && t < best.dist) {
          best.hit = true; best.dist = t; best.point = add(origin, scale(d, t)); best.body = b;
        }
      }
      return best;
    }
  }

  global.BOTWPhysics = {
    version: '9.0',
    World: World,
    Body: Body,
    vec: vec,
    quatFromEuler: quatFromEuler,
    quatIdentity: quatIdentity,
  };
})(typeof window !== 'undefined' ? window : this);
