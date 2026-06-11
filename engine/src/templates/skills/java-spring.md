# Java Spring Patterns - {{PROJECT_NAME}}

## Layered Architecture

```java
@RestController
@RequestMapping("/api/orders")
@RequiredArgsConstructor
public class OrderController {
  private final OrderService orderService;

  @PostMapping
  public ResponseEntity<OrderResponse> create(@Valid @RequestBody CreateOrderRequest request) {
    return ResponseEntity.status(HttpStatus.CREATED).body(orderService.create(request));
  }
}
```

```java
@Service
@RequiredArgsConstructor
public class OrderService {
  private final OrderRepository orderRepository;

  @Transactional
  public OrderResponse create(CreateOrderRequest request) {
    Order entity = new Order(request.customerId(), request.totalAmount());
    return OrderMapper.toResponse(orderRepository.save(entity));
  }
}
```

## DTO Validation

```java
public record CreateOrderRequest(
  @NotBlank String customerId,
  @NotNull @Positive BigDecimal totalAmount
) {}
```

## Error Handling

```java
@RestControllerAdvice
public class ApiExceptionHandler {
  @ExceptionHandler(MethodArgumentNotValidException.class)
  public ResponseEntity<Map<String, Object>> handleValidation(MethodArgumentNotValidException ex) {
    return ResponseEntity.badRequest().body(Map.of("error", "validation_failed"));
  }
}
```

## Persistence and Query Safety

```java
public interface OrderRepository extends JpaRepository<Order, Long> {
  List<Order> findByUserIdOrderByCreatedAtDesc(String userId);
}
```

- Keep business logic in services, not controllers or repositories.
- Validate all external input at the API boundary.
- Scope queries by authenticated user/tenant where applicable.
- Prefer constructor injection and immutable DTOs.
