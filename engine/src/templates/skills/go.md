# Go Patterns — {{PROJECT_NAME}}

## Error Handling

```go
// Always check errors — never discard with _
result, err := doSomething()
if err != nil {
    return fmt.Errorf("context message: %w", err)
}

// Sentinel errors
var ErrNotFound = errors.New("not found")

// Custom error type
type ValidationError struct{ Field, Message string }
func (e *ValidationError) Error() string {
    return fmt.Sprintf("validation error on %s: %s", e.Field, e.Message)
}
```

## HTTP Handler Pattern

```go
func (h *Handler) GetItem(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()
    id := chi.URLParam(r, "id") // or mux.Vars(r)["id"]
    
    item, err := h.service.GetItem(ctx, id)
    if errors.Is(err, ErrNotFound) {
        http.Error(w, "not found", http.StatusNotFound)
        return
    }
    if err != nil {
        http.Error(w, "internal error", http.StatusInternalServerError)
        return
    }
    json.NewEncoder(w).Encode(item)
}
```

## Context Pattern

```go
// Always pass context as first argument
func (s *Service) GetUser(ctx context.Context, id string) (*User, error) {
    // Respect cancellation
    select {
    case <-ctx.Done():
        return nil, ctx.Err()
    default:
    }
    return s.db.FindUser(ctx, id)
}
```

## Struct Tags

```go
type User struct {
    ID        string    `json:"id" db:"id"`
    Email     string    `json:"email" db:"email"`
    CreatedAt time.Time `json:"created_at" db:"created_at"`
}
```

## Testing

```go
func TestGetUser(t *testing.T) {
    tests := []struct {
        name    string
        id      string
        want    *User
        wantErr bool
    }{
        {"valid user", "123", &User{ID: "123"}, false},
        {"not found", "999", nil, true},
    }
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            got, err := svc.GetUser(context.Background(), tt.id)
            if (err != nil) != tt.wantErr { t.Errorf("unexpected error: %v", err) }
            if !reflect.DeepEqual(got, tt.want) { t.Errorf("got %v, want %v", got, tt.want) }
        })
    }
}
```
