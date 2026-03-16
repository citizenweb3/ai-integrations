# Globula — AI Dev Agent: Diagrams

---

## 1. Architecture Overview

```mermaid
graph TD
    DEV[Developer] --> ISSUE[GitHub Issue]
    ISSUE --> ACTIONS[GitHub Actions]
    ACTIONS --> CONTAINER[Docker Container]
    CONTAINER --> CLAUDE[Claude Code CLI]
    CLAUDE --> PR[Pull Request]
    PR --> REVIEWER[AI Code Reviewer]
    REVIEWER --> DEV
```

---

## 2. Full Task Cycle

```mermaid
graph TD
    A[Developer creates Issue] --> B[Agent reads codebase]
    B --> C[Agent writes code]
    C --> D[Agent creates PR]
    D --> E[AI reviews PR]
    E -->|OK| F[Developer reviews and merges]
    E -->|Problems found| G[Agent fixes issues]
    G --> D
    F -->|Request changes| H[Agent fixes feedback]
    H --> D
```

---

## 3. Inside the Container

```mermaid
graph TD
    A[GitHub Actions Job] --> B[Checkout + create branch]
    B --> C[Load agent persona]
    C --> D[Brainstorm: explore codebase]
    D --> E[Plan: define steps]
    E --> F[Implement code]
    F --> G[Run tests + lint]
    G -->|Pass| H[Create PR]
    G -->|Fail| I[Fix errors]
    I --> G
```

---

## 4. Three Workflows

### 4a. task-execute.yml

```mermaid
graph LR
    A[Issue created] --> B[Route by label] --> C[Create branch] --> D[Run agent] --> E[Create PR]
```

### 4b. pr-review.yml

```mermaid
graph LR
    A[PR opened] --> B[AI reviews code] --> C{Quality OK?}
    C -->|Yes| D[Approve]
    C -->|No| E[Request Changes]
```

### 4c. pr-fix.yml

```mermaid
graph LR
    A[Changes Requested] --> B[Read comments] --> C[Fix issues] --> D[Push fix]
```

### How workflows connect

```mermaid
graph TD
    A[task-execute] -->|creates PR| B[pr-review]
    B -->|changes needed| C[pr-fix]
    C -->|push fix| B
    B -->|approved| D[Developer merges]
```

---

## 5. Agent Persona

```mermaid
graph TD
    A[claude -p starts] --> B[Reads CLAUDE.md - project rules]
    B --> C[Reads agent persona - role and stack]
    C --> D[Loads skills - TDD, debug, review]
    D --> E[Agent ready to work]
```

---

## 6. Three Options

### Option A: Basic

```mermaid
graph LR
    A[Issue] --> B[Agent codes] --> C[PR] --> D[AI Review] --> E[Human merges]
```

### Option B: With auto-fix

```mermaid
graph LR
    A[Issue] --> B[Agent codes] --> C[PR] --> D[AI Review]
    D -->|Fix needed| E[Agent fixes] --> D
    D -->|OK| F[Human merges]
```

### Option C: Multi-agent

```mermaid
graph TD
    A[Issue] --> B[Lead Agent plans]
    B --> C[Sub-agent 1]
    B --> D[Sub-agent 2]
    B --> E[Sub-agent 3]
    C --> F[Lead assembles PR]
    D --> F
    E --> F
    F --> G[AI Review + Fix loop]
    G --> H[Human merges]
```

---

## 7. Security

```mermaid
graph TD
    A[AI Agent] --> B[Can: read code, write code, create branches, create PR, run tests]
    A --> C[Cannot: merge PR, deploy, access secrets, access production DB]
    B --> D[Everything goes through PR review]
    D --> E[Human is the final gate]
```
