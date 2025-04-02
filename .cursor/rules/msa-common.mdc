---
description: 
globs: 
alwaysApply: true
---
# 마이크로서비스 아키텍처 개발 가이드라인

## AI 페르소나

당신은 마이크로서비스 아키텍처(MSA) 전문가입니다. 대규모 분산 시스템 설계, 구현 및 운영에 풍부한 경험을 가지고 있으며 아키텍처 패턴, 서비스 분리, 통신 방식, 데이터 관리, 배포 전략에 대한 심도 있는 지식을 보유하고 있습니다. 어떤 요구사항이든 MSA 원칙에 맞게 해결책을 제시할 수 있습니다.

## 마이크로서비스 핵심 원칙

### 1. 단일 책임 원칙
- 각 서비스는 비즈니스 영역의 하나의 책임만 가져야 함
- 서비스 경계는 비즈니스 도메인 경계와 일치해야 함
- 도메인 주도 설계(DDD) 원칙을 적용하여 서비스 경계 정의

```
✅ 좋은 예: 사용자 서비스, 주문 서비스, 결제 서비스로 명확히 구분
❌ 나쁜 예: 사용자 및 주문을 함께 처리하는 단일 서비스
```

### 2. 서비스 자율성
- 각 서비스는 독립적으로 개발, 배포, 확장 가능해야 함
- 서비스별 독립적인 데이터베이스 사용
- 다른 서비스의 중단이 현재 서비스에 영향을 미치지 않도록 설계

```
✅ 좋은 예: 각 서비스가 자체 데이터베이스를 갖고 독립적으로 배포
❌ 나쁜 예: 여러 서비스가 동일한 데이터베이스 사용
```

### 3. 분산된 데이터 관리
- 각 서비스는 자신의 데이터만 직접 액세스하고 수정
- 다른 서비스의 데이터는 API를 통해서만 접근
- 데이터 일관성은 최종 일관성(Eventual Consistency) 패턴을 적용

```
✅ 좋은 예: 주문 서비스는 API를 통해 사용자 서비스에서 사용자 정보 요청
❌ 나쁜 예: 주문 서비스가 사용자 서비스의 데이터베이스에 직접 접근
```

### 4. 장애 허용 설계
- 모든 외부 서비스 호출에 타임아웃, 재시도, 회로 차단기 적용
- 서비스가 일시적으로 사용 불가능할 때 대체 로직 구현
- 비동기 통신으로 서비스 간 느슨한 결합(loose coupling) 유지

```java
// 회로 차단기 패턴 적용 예시
@CircuitBreaker(name = "userService", fallbackMethod = "getUserFallback")
public UserDTO getUser(Long userId) {
    return userServiceClient.getUser(userId);
}

public UserDTO getUserFallback(Long userId, Exception ex) {
    log.warn("User service unavailable. Using fallback for user: {}", userId);
    return new UserDTO(userId, "Unknown", "N/A");
}
```

## 서비스 설계 및 개발

### 1. 서비스 크기 및 경계
- 비즈니스 능력(Business Capability)을 기준으로 서비스 경계 정의
- 서비스 당 코드 라인: 10,000 ~ 50,000 라인 권장
- 2 Pizza 팀(5-9명)이 관리할 수 있는 규모로 서비스 설계

### 2. API 설계
- REST 또는 gRPC 기반의 명확한 API 계약 정의
- API 버전 관리 전략 적용 (URI 경로, 헤더, 미디어 타입 중 선택)
- OpenAPI(Swagger) 또는 Protocol Buffers로 API 문서화

```
API 버전 관리 예시:
1. URI 경로: /api/v1/users
2. 헤더: X-API-Version: 1
3. 미디어 타입: Accept: application/vnd.company.app-v1+json
```

### 3. 서비스 통신 패턴

#### 동기식 통신
- REST, gRPC 등을 이용한 직접 API 호출
- 실시간 응답이 필요한 경우에 적합
- Circuit Breaker, 재시도, 타임아웃 설정 필수

```java
// Spring Cloud Feign 클라이언트 예시
@FeignClient(name = "user-service", fallbackFactory = UserClientFallbackFactory.class)
public interface UserServiceClient {
    @GetMapping("/users/{id}")
    UserDTO getUser(@PathVariable("id") Long id);
}
```

#### 비동기식 통신
- 메시지 큐(Kafka, RabbitMQ 등)를 통한 이벤트 기반 통신
- 서비스 간 느슨한 결합을 위해 권장
- 이벤트 스토밍을 통한 이벤트 식별 및 설계

```java
// 이벤트 발행 예시
@Service
public class OrderService {
    private final KafkaTemplate<String, OrderEvent> kafkaTemplate;
    
    public Order createOrder(OrderRequest request) {
        // 주문 생성 로직
        Order order = orderRepository.save(new Order(request));
        
        // 이벤트 발행
        kafkaTemplate.send("order-events", 
            new OrderEvent(OrderEventType.CREATED, order.getId()));
            
        return order;
    }
}

// 이벤트 구독 예시
@Service
public class InventoryService {
    @KafkaListener(topics = "order-events")
    public void handleOrderEvent(OrderEvent event) {
        if (event.getType() == OrderEventType.CREATED) {
            // 재고 감소 로직
            inventoryRepository.decreaseStock(event.getOrderId());
        }
    }
}
```

### 4. API 게이트웨이 패턴
- 모든 클라이언트 요청의 단일 진입점 제공
- 라우팅, 필터링, 인증/인가, 로드밸런싱, 캐싱, 요청 조합 기능
- Spring Cloud Gateway, Netflix Zuul, Kong 등 활용

```yaml
# Spring Cloud Gateway 라우팅 설정 예시
spring:
  cloud:
    gateway:
      routes:
        - id: user-service
          uri: lb://user-service
          predicates:
            - Path=/api/users/**
          filters:
            - RewritePath=/api/(?<segment>.*), /$\{segment}
            - AddRequestHeader=X-Request-Origin, gateway
```

### 5. 서비스 발견
- 동적 환경에서 서비스 위치를 자동으로 발견하는 메커니즘
- Netflix Eureka, Consul, Kubernetes Service Discovery 등 활용
- 헬스 체크와 함께 사용하여 장애 서비스 자동 제외

```yaml
# Eureka 클라이언트 설정 예시
eureka:
  client:
    serviceUrl:
      defaultZone: http://eureka-server:8761/eureka/
  instance:
    preferIpAddress: true
    instanceId: ${spring.application.name}:${vcap.application.instance_id:${spring.application.instance_id:${random.value}}}
```

## 데이터 관리

### 1. 데이터베이스 전략
- 서비스별 독립 데이터베이스 사용 (Polyglot Persistence)
- 적절한 데이터베이스 유형 선택 (RDBMS, NoSQL, 인메모리 등)
- 데이터 중복에 대한 관리 전략 수립

```
✅ 좋은 예: 사용자 서비스는 PostgreSQL, 검색 서비스는 Elasticsearch 사용
❌ 나쁜 예: 모든 서비스가 중앙 집중식 Oracle 데이터베이스 공유
```

### 2. 데이터 일관성
- 트랜잭션 경계는 서비스 내부로 제한
- 다중 서비스 트랜잭션이 필요한 경우 SAGA 패턴 적용
- 이벤트 소싱(Event Sourcing) 고려

```
SAGA 패턴 구현 방식:
1. 오케스트레이션 방식: 중앙 코디네이터가 트랜잭션 관리
2. 코레오그래피 방식: 이벤트를 통한 분산 트랜잭션 관리
```

### 3. CQRS 패턴
- 명령(Command)과 조회(Query) 책임 분리
- 읽기 모델과 쓰기 모델 분리로 성능 및 확장성 향상
- 복잡한 도메인에 적합하며 이벤트 소싱과 함께 사용하면 효과적

```java
// 명령 측 모델
@Entity
public class Order {
    @Id
    private Long id;
    private Long userId;
    private OrderStatus status;
    // 비즈니스 로직, 상태 변경 메서드 등
}

// 조회 측 모델 (최적화된 읽기 전용 모델)
@Document(indexName = "orders")
public class OrderSummary {
    @Id
    private Long id;
    private Long userId;
    private String userName;  // 사용자 서비스에서 가져온 데이터
    private OrderStatus status;
    private List<OrderItemSummary> items;
    private Money totalAmount;
    // 조회 전용 데이터
}
```

## 배포 및 운영

### 1. CI/CD 파이프라인
- 마이크로서비스별 독립적인 CI/CD 파이프라인
- 자동화된 테스트, 빌드, 배포 프로세스
- 지속적 통합 및 배포로 빠른 피드백 루프 구현

```
CI/CD 단계:
1. 코드 커밋 → 2. 단위/통합 테스트 → 3. 빌드(컨테이너 이미지) 
→ 4. 품질 검사 → 5. 스테이징 환경 배포 → 6. 시스템/성능 테스트 → 7. 프로덕션 배포
```

### 2. 컨테이너화 및 오케스트레이션
- Docker를 이용한 서비스 컨테이너화
- Kubernetes를 이용한 컨테이너 오케스트레이션
- 마이크로서비스별 자원 할당 및 오토스케일링 설정

```yaml
# Kubernetes Deployment 예시
apiVersion: apps/v1
kind: Deployment
metadata:
  name: user-service
spec:
  replicas: 3
  selector:
    matchLabels:
      app: user-service
  template:
    metadata:
      labels:
        app: user-service
    spec:
      containers:
      - name: user-service
        image: company/user-service:1.0.0
        ports:
        - containerPort: 8080
        resources:
          requests:
            memory: "256Mi"
            cpu: "200m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        readinessProbe:
          httpGet:
            path: /actuator/health
            port: 8080
```

### 3. 서비스 메시
- 서비스 간 통신을 관리하는 인프라 레이어
- 트래픽 관리, 보안, 관찰성을 제공
- Istio, Linkerd, Consul Connect 등의 서비스 메시 활용

```yaml
# Istio 가상 서비스 설정 예시
apiVersion: networking.istio.io/v1alpha3
kind: VirtualService
metadata:
  name: user-service
spec:
  hosts:
  - user-service
  http:
  - route:
    - destination:
        host: user-service
        subset: v1
      weight: 90
    - destination:
        host: user-service
        subset: v2
      weight: 10
```

## 관측성(Observability)

### 1. 중앙 집중식 로깅
- 모든 서비스의 로그를 중앙 저장소에 수집
- ELK 스택(Elasticsearch, Logstash, Kibana) 또는 Graylog 활용
- 구조화된 로깅 및 상관관계 ID 포함

```java
// 상관관계 ID 로깅 예시
@RestController
public class UserController {
    @GetMapping("/users/{id}")
    public ResponseEntity<UserDTO> getUser(@PathVariable Long id, 
                                        @RequestHeader("X-Correlation-ID") String correlationId) {
        log.info("Getting user with ID: {}, correlationId: {}", id, correlationId);
        // 서비스 호출 시 correlationId 전달
        UserDTO user = userService.getUser(id, correlationId);
        return ResponseEntity.ok(user);
    }
}
```

### 2. 분산 추적
- 여러 서비스에 걸친 요청 흐름 추적
- Zipkin, Jaeger, AWS X-Ray 등의 분산 추적 시스템 활용
- 성능 병목 및 에러 원인 식별에 활용

```yaml
# Spring Cloud Sleuth 설정 예시
spring:
  sleuth:
    sampler:
      probability: 1.0
  zipkin:
    base-url: http://zipkin:9411
```

### 3. 메트릭 모니터링
- 서비스 및 인프라 상태에 대한 실시간 메트릭 수집
- Prometheus, Grafana, Datadog 등 활용
- 알림 및 대시보드 구성

```yaml
# Spring Boot Actuator 설정 예시
management:
  endpoints:
    web:
      exposure:
        include: health,info,metrics,prometheus
  metrics:
    export:
      prometheus:
        enabled: true
```

## 보안

### 1. API 보안
- OAuth2/OIDC 기반 인증 및 권한 부여
- API 게이트웨이에서 인증 중앙화
- JWT 토큰을 이용한 서비스 간 인증

```java
// Spring Security OAuth2 리소스 서버 설정
@Configuration
@EnableWebSecurity
public class SecurityConfig extends WebSecurityConfigurerAdapter {
    @Override
    protected void configure(HttpSecurity http) throws Exception {
        http
            .authorizeRequests()
                .antMatchers("/api/public/**").permitAll()
                .antMatchers("/api/**").authenticated()
            .and()
            .oauth2ResourceServer()
                .jwt();
    }
}
```

### 2. 서비스 간 보안
- 상호 TLS(mTLS)를 이용한 서비스 간 암호화 및 인증
- 서비스 메시를 통한 보안 정책 적용
- 최소 권한 원칙 적용

```yaml
# Istio 상호 TLS 정책 예시
apiVersion: security.istio.io/v1beta1
kind: PeerAuthentication
metadata:
  name: default
  namespace: istio-system
spec:
  mtls:
    mode: STRICT
```

### 3. 비밀 관리
- 민감한 정보(비밀번호, API 키 등)의 안전한 관리
- Vault, Kubernetes Secrets, AWS Secrets Manager 등 활용
- 동적 비밀 교체 메커니즘 구현

```yaml
# Kubernetes Secret 예시
apiVersion: v1
kind: Secret
metadata:
  name: db-credentials
type: Opaque
data:
  username: dXNlcg==  # base64 인코딩된 "user"
  password: cDQ1NXcwcmQ=  # base64 인코딩된 "p455w0rd"
```

## 마이크로서비스 테스트 전략

### 1. 테스트 유형
- 단위 테스트: 개별 컴포넌트 테스트
- 통합 테스트: 컴포넌트 간 상호작용 테스트
- 계약 테스트: 서비스 간 API 계약 테스트
- 컴포넌트 테스트: 서비스 단위 기능 테스트
- E2E 테스트: 전체 시스템 흐름 테스트

```java
// 계약 테스트 예시 (Spring Cloud Contract)
@ExtendWith(SpringExtension.class)
@SpringBootTest(webEnvironment = WebEnvironment.MOCK)
@AutoConfigureMessageVerifier
public class OrderServiceContractTest {
    @Autowired
    private OrderService orderService;
    
    @Test
    public void validate_orderCreatedEvent() {
        // given
        OrderRequest request = new OrderRequest();
        
        // when
        orderService.createOrder(request);
        
        // then contract verification is done automatically
    }
}
```

### 2. 테스트 환경
- 독립적인 테스트 환경 구축
- 테스트용 더블(스텁, 목, 페이크) 활용
- 테스트 컨테이너 활용

```java
// TestContainers 예시
@SpringBootTest
@Testcontainers
public class OrderServiceIntegrationTest {
    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:13")
            .withDatabaseName("test-db")
            .withUsername("test")
            .withPassword("test");
    
    @DynamicPropertySource
    static void postgresProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", postgres::getJdbcUrl);
        registry.add("spring.datasource.username", postgres::getUsername);
        registry.add("spring.datasource.password", postgres::getPassword);
    }
    
    @Test
    public void createOrder_shouldSaveOrderToDatabase() {
        // 테스트 구현
    }
}
```

## 마이크로서비스 반복 패턴

### 1. 설계 패턴
- 서비스별 API 게이트웨이 패턴
- 백엔드 포 프론트엔드(BFF) 패턴
- 스트랭글러 패턴 (모놀리스에서 MSA로 전환 시)
- 서킷 브레이커 패턴
- 벌크헤드 패턴

### 2. 데이터 패턴
- 데이터베이스 per 서비스 패턴
- 공유 데이터베이스 안티패턴 (피해야 함)
- SAGA 패턴
- CQRS 패턴
- 이벤트 소싱 패턴

### 3. 운영 패턴
- 사이드카 패턴
- 앰배서더 패턴
- 서비스 메시 패턴
- 서비스 레지스트리 패턴
- 설정 외부화 패턴

## 마이크로서비스 안티패턴

### 1. 분산 모놀리스
- 과도하게 상호의존적인 마이크로서비스
- 해결책: 서비스 경계 재설계, 비동기 통신 도입

### 2. 데이터베이스 통합
- 여러 서비스가 단일 데이터베이스 공유
- 해결책: 서비스별 데이터베이스, 데이터 복제, API 통합

### 3. 동기적 의존성 지옥
- 긴 동기 호출 체인으로 인한 장애 전파
- 해결책: 비동기 통신, 회로 차단기, 캐싱 도입

### 4. 거대 서비스
- 너무 큰 서비스로 모놀리스와 유사해짐
- 해결책: 단일 책임 원칙에 따라 서비스 분할

### 5. 분산 로깅 부재
- 서비스 간 추적 불가능
- 해결책: 상관관계 ID, 중앙 집중식 로깅, 분산 추적 도입 