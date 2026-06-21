// ==========================================
// 1. 초기 세팅 및 글로벌 변수 선언
// ==========================================
const scene = new THREE.Scene();
// 짙은 우주/SF 터널 느낌을 위한 안개 효과 추가 (완성도 뻥튀기)
scene.fog = new THREE.FogExp2(0x111124, 0.008);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 2.5, 10);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x24253c, 1);
// 쨍한 색감을 위한 톤매핑 및 보정 설정 활성화
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 2.8;
document.body.appendChild(renderer.domElement);

let cameraMode = 'P'; 
const targetCameraPos = new THREE.Vector3();
const keys = { w: false, s: false, a: false, d: false };

const airplane = {
    mesh: null,
    currentPos: new THREE.Vector3(0, 0, 0),
    targetPos: new THREE.Vector3(0, 0, 0),
    currentQuat: new THREE.Quaternion(),
    targetQuat: new THREE.Quaternion(),
    speed: 0.18,
    lerpFactor: 0.1,
    radius: 1.0
};

const tunnelLength = 200;
const speedZ = 0.6; // 박진감 넘치는 속도감 상향
let neonColorPhase = 0;
let isGameOver = false;

const obstacles = [];
const numObstacles = 10;

// ==========================================
// 2. [비주얼 극대화] 실시간 네온 GI 셰이더 (수치 대폭 상향)
// ==========================================
const giMaterial = new THREE.ShaderMaterial({
    uniforms: {
        uNeonColor: { value: new THREE.Color(1, 0, 0) },
        uNeonPos: { value: new THREE.Vector3(0, 0, 0) },
        uAmbient: { value: new THREE.Color(0.65, 0.65, 0.65) } // 터널 기본 밝기를 최대치로 올림
    },
    vertexShader: `
        varying vec3 vWorldPos;
        varying vec3 vNormal;
        void main() {
            vec4 worldPos = modelMatrix * vec4(position, 1.0);
            vWorldPos = worldPos.xyz;
            // 내부 벽면을 향하도록 법선 방향 정밀화
            vNormal = normalize(normalMatrix * vec4(normal, 0.0)).xyz;
            gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
    `,
    fragmentShader: `
        uniform vec3 uNeonColor;
        uniform vec3 uNeonPos;
        uniform vec3 uAmbient;
        varying vec3 vWorldPos;
        varying vec3 vNormal;
        void main() {
            vec3 L = normalize(uNeonPos - vWorldPos);
            float dist = distance(uNeonPos, vWorldPos);
            
            // 양방향 램베르트 근사 및 저주파 조명 감쇄 모델 적용 (GI 연산식 고도화)
            float dotNL = abs(dot(vNormal, L));
            
            // 역자승 감쇄를 보완하여 터널 벽 전체가 네온으로 강하게 빛나게 함
            float attentuation = 420.0 / (1.0 + dist * 0.06 + dist * dist * 0.006);
            vec3 indirectLighting = uNeonColor * (dotNL * attentuation);
            
            // 네온 글로우를 더 강조하도록 최종 색상에 배가
            vec3 finalColor = uAmbient + indirectLighting * 3.0;
            
            gl_FragColor = vec4(finalColor, 1.0);
        }
    `,
    side: THREE.DoubleSide
});

// 터널 지오메트리 세그먼트를 늘려 부드러운 원형으로 개선
const tunnelGeo = new THREE.CylinderGeometry(14, 14, tunnelLength, 64, 1, true);
tunnelGeo.rotateX(Math.PI / 2);
const tunnel = new THREE.Mesh(tunnelGeo, giMaterial);
scene.add(tunnel);

// [비주얼 핵심] 자체 발광 구체를 화려한 글로우 색상으로 매핑
const neonGeo = new THREE.SphereGeometry(3.5, 32, 32);
const neonMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
const neonLightMesh = new THREE.Mesh(neonGeo, neonMat);
scene.add(neonLightMesh);

// 실제 네온 광원을 추가하여 터널 전체 조명 영향을 강화
const neonPointLight = new THREE.PointLight(0xff0000, 8.5, 160, 2);
neonPointLight.position.copy(neonLightMesh.position);
scene.add(neonPointLight);

// 전체 장면 밝기를 높이는 서브 앰비언트 라이트
const ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
scene.add(ambientLight);

// 터널 라이트를 보조하는 추가 방향광
const fillLight = new THREE.DirectionalLight(0xffffff, 0.6);
fillLight.position.set(-5, 5, 10);
scene.add(fillLight);

// ==========================================
// 3. SF 기둥 장애물 생성 (크기 및 컬러 고급화)
// ==========================================
const obstacleGeo = new THREE.CylinderGeometry(0.8, 1.2, 28, 16);
// 장애물도 네온 빛을 받아 반사하도록 러스니스 조절
const obstacleMat = new THREE.MeshStandardMaterial({ color: 0x22222a, roughness: 0.2, metalness: 0.8 });

function createObstacle(zOffset) {
    const obs = new THREE.Mesh(obstacleGeo, obstacleMat);
    obs.position.set(
        (Math.random() - 0.5) * 16,
        (Math.random() - 0.5) * 16,
        zOffset
    );
    obs.rotation.set(Math.random() * Math.PI, 0, Math.random() * Math.PI);
    scene.add(obs);
    obstacles.push(obs);
}

for (let i = 0; i < numObstacles; i++) {
    createObstacle(-40 - i * 22);
}

// ==========================================
// 4. 비행기 세련된 크롬 도색 및 디자인 업그레이드
// ==========================================
const airplaneGroup = new THREE.Group();
const bodyGeo = new THREE.ConeGeometry(0.8, 3.5, 4);
bodyGeo.rotateX(Math.PI / 2);
// 메탈릭 실버 크롬 재질로 변경하여 조명 반사 극대화
const silverMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.9, roughness: 0.1 });
const body = new THREE.Mesh(bodyGeo, silverMat);
airplaneGroup.add(body);

const wingGeo = new THREE.BoxGeometry(3.5, 0.08, 0.8);
const wing = new THREE.Mesh(wingGeo, silverMat);
airplaneGroup.add(wing);

airplane.mesh = airplaneGroup;
scene.add(airplane.mesh);
airplane.mesh.matrixAutoUpdate = false; 

// 터널 내부 장애물들을 비춰줄 대비용 서브 다이렉셔널 라이트 배치
const dirLight1 = new THREE.DirectionalLight(0x333344, 0.8);
dirLight1.position.set(5, 10, 5);
scene.add(dirLight1);

// ==========================================
// 5. 조작 이벤트 리스너
// ==========================================
window.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    if (key === 'w') keys.w = true;
    if (key === 's') keys.s = true;
    if (key === 'a') keys.a = true;
    if (key === 'd') keys.d = true;
    if (key === 'o') cameraMode = 'O';
    if (key === 'p') cameraMode = 'P';
});

window.addEventListener('keyup', (e) => {
    const key = e.key.toLowerCase();
    if (key === 'w') keys.w = false;
    if (key === 's') keys.s = false;
    if (key === 'a') keys.a = false;
    if (key === 'd') keys.d = false;
});

function resetGame() {
    isGameOver = false;
    airplane.currentPos.set(0, 0, 0);
    airplane.targetPos.set(0, 0, 0);
    airplane.currentQuat.set(0, 0, 0, 1);
    tunnel.position.set(0, 0, 0);
    
    for (let i = 0; i < obstacles.length; i++) {
        obstacles[i].position.set(
            (Math.random() - 0.5) * 16,
            (Math.random() - 0.5) * 16,
            -40 - i * 22
        );
    }
    renderer.setClearColor(0x000000, 1);
}

// ==========================================
// 6. 메인 애니메이션 루프 및 카메라 내부 고정
// ==========================================
function animate() {
    requestAnimationFrame(animate);

    if (isGameOver) return;

    // 6-1. 클럽 모드 급의 사이키델릭 보라-초록-루비 네온 칼라 변환 루프
    neonColorPhase += 0.025;
    const r = Math.abs(Math.sin(neonColorPhase) * 1.5);
    const g = Math.abs(Math.cos(neonColorPhase * 0.7) * 1.5);
    const b = Math.abs(Math.sin(neonColorPhase * 1.3) * 1.5);
    
    giMaterial.uniforms.uNeonColor.value.setRGB(r, g, b);
    neonMat.color.setRGB(r, g, b);
    neonPointLight.color.setRGB(r, g, b);
    neonPointLight.intensity = 8.5;

    // 구체 조명을 비행기 앞 적절한 뷰 거리에 배치하여 터널 벽면 스윕 연출
    neonLightMesh.position.set(Math.sin(neonColorPhase) * 5, Math.cos(neonColorPhase * 5), airplane.currentPos.z - 45);
    neonPointLight.position.copy(neonLightMesh.position);
    giMaterial.uniforms.uNeonPos.value.copy(neonLightMesh.position);

    // 6-2. 비행기 조종 범위 확장
    if (keys.w) airplane.targetPos.y += airplane.speed;
    if (keys.s) airplane.targetPos.y -= airplane.speed;
    if (keys.a) airplane.targetPos.x -= airplane.speed;
    if (keys.d) airplane.targetPos.x += airplane.speed;

    airplane.targetPos.x = THREE.MathUtils.clamp(airplane.targetPos.x, -9, 9);
    airplane.targetPos.y = THREE.MathUtils.clamp(airplane.targetPos.y, -9, 9);
    airplane.targetPos.z -= speedZ;

    airplane.currentPos.lerp(airplane.targetPos, airplane.lerpFactor);

    // 6-3. 쿼터니언 Slerp
    const rollAngle = (airplane.targetPos.x - airplane.currentPos.x) * -0.6;
    const pitchAngle = (airplane.targetPos.y - airplane.currentPos.y) * 0.6;
    const targetRotation = new THREE.Euler(pitchAngle, 0, rollAngle);
    airplane.targetQuat.setFromEuler(targetRotation);
    airplane.currentQuat.slerp(airplane.targetQuat, airplane.lerpFactor);

    // 6-4. 아핀 행렬 수동 제어 결합 (compose)
    const scale = new THREE.Vector3(1, 1, 1);
    airplane.mesh.matrix.compose(airplane.currentPos, airplane.currentQuat, scale);

    // 6-5. 장애물 재배치 및 충돌 판정
    obstacles.forEach(obs => {
        if (obs.position.z > camera.position.z) {
            obs.position.z = airplane.currentPos.z - 180;
            obs.position.x = (Math.random() - 0.5) * 16;
            obs.position.y = (Math.random() - 0.5) * 16;
        }

        const distance = airplane.currentPos.distanceTo(obs.position);
        if (distance < (airplane.radius + 1.0)) {
            isGameOver = true;
            renderer.setClearColor(0xff2222, 1); // 세련된 붉은 충돌 플래시 효과
            setTimeout(() => { resetGame(); }, 800);
        }
    });

    // 6-6. [핵심 수정] 카메라 위치를 터널 내부(Inside Tunnel)로 고정하여 뷰 대폭 개선
    if (cameraMode === 'O') {
        // 1인칭 콕핏 뷰
        targetCameraPos.set(airplane.currentPos.x, airplane.currentPos.y + 0.5, airplane.currentPos.z - 0.5);
        camera.lookAt(airplane.currentPos.x, airplane.currentPos.y, airplane.currentPos.z - 40);
    } else {
        // [수정] 3인칭 뷰 시 카메라를 비행기 뒤쪽 터널 내부 축(Y축 +2.5, Z축 +8)으로 바짝 붙여 몰입감 극대화
        targetCameraPos.set(airplane.currentPos.x, airplane.currentPos.y + 2.5, airplane.currentPos.z + 8);
        camera.lookAt(airplane.currentPos.x, airplane.currentPos.y + 0.5, airplane.currentPos.z - 10);
    }
    camera.position.lerp(targetCameraPos, 0.08);

    // 무한 맵 스크롤 동기화
    if (airplane.currentPos.z < tunnel.position.z - tunnelLength / 2) {
        tunnel.position.z -= tunnelLength;
    }

    renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

animate();