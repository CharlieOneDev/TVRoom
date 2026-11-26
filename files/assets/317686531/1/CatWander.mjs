
import { Script, Vec3 } from 'playcanvas';

export class CatWander extends Script {
    static scriptName = 'catWander';

    initialize() {
        // =====================================
        // 1. MOVEMENT SETTINGS
        // =====================================

        this.runSpeed = 0.85;
        this.walkSpeed = 0.32;

        this.turnSpeed = 140;

        // 0 = model faces local -Z
        // 180 = model faces local +Z
        this.forwardOffset = 180;

        // =====================================
        // 2. ANIMATION TIMELINE
        // =====================================

        this.totalDuration = 13.0;

        this.standEnd = 8.68;
        this.runEnd = 10.74;

        // 0 - 8.68: Standing
        // 8.68 - 10.74: Running
        // 10.74 - 13.00: Walking

        // =====================================
        // 3. OBSTACLE DETECTION
        // =====================================

        this.rayDistance = 0.7;

        // Detection heights relative to CatRoot
        this.probeHeights = [
            0.2,
            0.45,
            0.7
        ];

        // Detection positions across cat's width
        this.probeSideOffsets = [
            -0.08,
            0,
            0.08
        ];

        this.rayStart = new Vec3();
        this.rayEnd = new Vec3();

        this.physics = this.app.systems.rigidbody || null;

        this.physicsReady = !!(
            this.physics &&
            typeof this.physics.raycastFirst === 'function'
        );

        if (!this.physicsReady) {
            console.warn(
                '[CatWander] Rigidbody raycast system unavailable. ' +
                'Obstacle detection disabled.'
            );
        }

        // =====================================
        // 4. ROTATION
        // =====================================

        const angles = this.entity.getEulerAngles();

        this.pitch = angles.x;
        this.yaw = angles.y;
        this.roll = angles.z;

        this.targetYaw = this.yaw;
        this.turning = false;

        // =====================================
        // 5. RANDOM WANDERING
        // =====================================

        this.wanderTimer = this.randomRange(4, 7);

        // =====================================
        // 6. DEBUG
        // =====================================

        this.animInfoLogged = false;

        console.log(
            '[CatWander] Initialized:',
            this.entity.name
        );
    }

    // =====================================
    // GET ANIMATION TIME
    // =====================================

    getTimelineTime() {
        const layer = this.entity.anim?.baseLayer;

        if (!layer) return null;

        const duration = layer.activeStateDuration;
        const currentTime = layer.activeStateCurrentTime;

        if (
            !Number.isFinite(duration) ||
            duration <= 0 ||
            !Number.isFinite(currentTime)
        ) {
            return null;
        }

        // Convert current animation time to a 13-second timeline.
        const wrappedTime =
            ((currentTime % duration) + duration) % duration;

        const timelineTime =
            wrappedTime / duration * this.totalDuration;

        if (!this.animInfoLogged) {
            console.log(
                '[CatWander] Animation:',
                layer.activeState,
                'Duration:',
                duration.toFixed(2)
            );

            this.animInfoLogged = true;
        }

        return timelineTime;
    }

    // =====================================
    // GET MOVEMENT SPEED
    // =====================================

    getMovementSpeed(time) {

        // Standing
        if (time < this.standEnd) {
            return 0;
        }

        // Running
        if (time < this.runEnd) {
            return this.runSpeed;
        }

        // Slow walking
        return this.walkSpeed;
    }

    // =====================================
    // MAIN UPDATE
    // =====================================

    update(dt) {
        const animationTime = this.getTimelineTime();

        // Wait for the animation to become available.
        if (animationTime === null) return;

        const movementSpeed =
            this.getMovementSpeed(animationTime);

        // Limit large frame-time jumps to reduce tunneling.
        const safeDt = Math.min(Math.max(dt, 0), 0.05);

        // -------------------------------------
        // A. FINISH TURNING BEFORE MOVING
        // -------------------------------------

        if (this.turning) {
            this.updateTurn(safeDt);
            return;
        }

        // -------------------------------------
        // B. STANDING
        // -------------------------------------

        if (movementSpeed <= 0) {
            return;
        }

        // -------------------------------------
        // C. CHECK OBSTACLES EVERY FRAME
        // -------------------------------------

        if (this.physicsReady && this.isBlocked(0)) {
            this.avoidObstacle();

            // Begin turning immediately.
            // Do not move forward during this frame.
            this.updateTurn(safeDt);

            return;
        }

        // -------------------------------------
        // D. RANDOM DIRECTION CHANGE
        // -------------------------------------

        this.wanderTimer -= safeDt;

        if (this.wanderTimer <= 0) {
            this.wanderTimer = this.randomRange(4, 7);

            if (Math.random() < 0.75) {
                const direction =
                    Math.random() < 0.5 ? -1 : 1;

                const angle =
                    this.randomRange(35, 65);

                this.startTurn(direction * angle);
                this.updateTurn(safeDt);

                return;
            }
        }

        // -------------------------------------
        // E. MOVE FORWARD
        // -------------------------------------

        this.moveForward(movementSpeed, safeDt);
    }

    // =====================================
    // MOVE FORWARD
    // =====================================

    moveForward(speed, dt) {
        const heading =
            (this.yaw + this.forwardOffset) *
            Math.PI / 180;

        const dx = -Math.sin(heading);
        const dz = -Math.cos(heading);

        const pos = this.entity.getPosition();

        this.entity.setPosition(
            pos.x + dx * speed * dt,
            pos.y,
            pos.z + dz * speed * dt
        );
    }

    // =====================================
    // MULTI-RAY OBSTACLE DETECTION
    // =====================================

    isBlocked(angleOffset = 0) {
        if (!this.physicsReady) return false;

        const pos = this.entity.getPosition();

        const heading =
            (
                this.yaw +
                this.forwardOffset +
                angleOffset
            ) * Math.PI / 180;

        // Forward direction
        const dx = -Math.sin(heading);
        const dz = -Math.cos(heading);

        // Right direction
        const rightX = Math.cos(heading);
        const rightZ = -Math.sin(heading);

        // 3 heights x 3 horizontal positions = 9 rays
        for (const height of this.probeHeights) {
            for (const side of this.probeSideOffsets) {

                this.rayStart.set(
                    pos.x + rightX * side,
                    pos.y + height,
                    pos.z + rightZ * side
                );

                this.rayEnd.set(
                    this.rayStart.x + dx * this.rayDistance,
                    this.rayStart.y,
                    this.rayStart.z + dz * this.rayDistance
                );

                const result =
                    this.physics.raycastFirst(
                        this.rayStart,
                        this.rayEnd,
                        {
                            filterCallback: (hitEntity) => {
                                // Ignore the cat and its descendants.
                                return !this.isCatEntity(hitEntity);
                            }
                        }
                    );

                if (result !== null) {
                    return true;
                }
            }
        }

        return false;
    }

    // =====================================
    // IGNORE CAT'S OWN COLLIDERS
    // =====================================

    isCatEntity(hitEntity) {
        let current = hitEntity;

        while (current) {
            if (current === this.entity) {
                return true;
            }

            current = current.parent;
        }

        return false;
    }

    // =====================================
    // OBSTACLE AVOIDANCE
    // =====================================

    avoidObstacle() {

        // Positive angle = left
        // Negative angle = right

        const leftBlocked = this.isBlocked(50);
        const rightBlocked = this.isBlocked(-50);

        let direction;
        let angle;

        if (!leftBlocked && rightBlocked) {

            // Left side is clear.
            direction = 1;
            angle = this.randomRange(80, 105);

        } else if (leftBlocked && !rightBlocked) {

            // Right side is clear.
            direction = -1;
            angle = this.randomRange(80, 105);

        } else if (!leftBlocked && !rightBlocked) {

            // Both sides are clear.
            direction = Math.random() < 0.5 ? 1 : -1;
            angle = this.randomRange(75, 100);

        } else {

            // Both sides are blocked.
            // Turn around.
            direction = Math.random() < 0.5 ? 1 : -1;
            angle = this.randomRange(155, 180);
        }

        this.startTurn(direction * angle);
    }

    // =====================================
    // START TURN
    // =====================================

    startTurn(angle) {
        this.targetYaw = this.yaw + angle;
        this.turning = true;

        // Wait several seconds before random turning again.
        this.wanderTimer = this.randomRange(4, 7);
    }

    // =====================================
    // UPDATE TURN
    // =====================================

    updateTurn(dt) {
        const difference =
            ((this.targetYaw - this.yaw + 540) % 360) - 180;

        const maxStep = this.turnSpeed * dt;

        if (Math.abs(difference) <= maxStep) {

            this.yaw = this.targetYaw;
            this.turning = false;

        } else {

            this.yaw +=
                Math.sign(difference) * maxStep;
        }

        this.entity.setEulerAngles(
            this.pitch,
            this.yaw,
            this.roll
        );
    }

    // =====================================
    // RANDOM NUMBER
    // =====================================

    randomRange(min, max) {
        return min + Math.random() * (max - min);
    }
}
