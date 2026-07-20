# Subagent Delegation

Learn how agents can delegate tasks to specialized subagents.

## Delegation Model

```
Parent Agent
    ├── Analysis Subagent
    ├── Implementation Subagent
    ├── Testing Subagent
    └── Review Subagent
```

## Basic Delegation

### Direct Delegation

```typescript
const parentAgent = {
  id: 'project-manager',
  async handleTask(task) {
    // Decompose task
    const subtasks = this.decompose(task);
    
    // Delegate to subagents
    const results = await Promise.all(
      subtasks.map(st => 
        this.delegate(st.agent, st.task)
      )
    );
    
    // Aggregate results
    return this.aggregate(results);
  }
};
```

### Hierarchical Delegation

```typescript
const hierarchy = {
  'ceo': {
    children: ['cto', 'cfo'],
    responsibilities: ['strategy']
  },
  'cto': {
    children: ['lead-dev', 'architect'],
    responsibilities: ['technology']
  }
};
```

## Delegation Patterns

### Round Robin

```typescript
const roundRobin = {
  agents: ['worker-1', 'worker-2', 'worker-3'],
  index: 0,
  
  delegate(task) {
    const agent = this.agents[this.index];
    this.index = (this.index + 1) % this.agents.length;
    return this.sendToAgent(agent, task);
  }
};
```

### Load-Based

```typescript
const loadBased = {
  async delegate(task) {
    const loads = await Promise.all(
      this.agents.map(a => a.getLoad())
    );
    
    const leastLoaded = this.agents[
      loads.indexOf(Math.min(...loads))
    ];
    
    return this.sendToAgent(leastLoaded, task);
  }
};
```

### Skill-Based

```typescript
const skillBased = {
  async delegate(task) {
    const requiredSkills = task.requiredSkills;
    
    const capableAgents = this.agents.filter(a =>
      requiredSkills.every(s => a.skills.includes(s))
    );
    
    return this.sendToAgent(capableAgents[0], task);
  }
};
```

## Context Passing

### Full Context

```typescript
const delegateWithContext = (parent, subagent, task) => {
  return subagent.execute({
    ...task,
    parentContext: parent.getContext(),
    parentHistory: parent.getHistory()
  });
};
```

### Minimal Context

```typescript
const delegateMinimal = (parent, subagent, task) => {
  return subagent.execute({
    task: task.description,
    constraints: task.constraints
  });
};
```

## Result Aggregation

### Sequential Aggregation

```typescript
const sequentialAggregate = async (results) => {
  let combined = '';
  for (const result of results) {
    combined += await processResult(result);
  }
  return combined;
};
```

### Parallel Aggregation

```typescript
const parallelAggregate = async (results) => {
  const processed = await Promise.all(
    results.map(r => processResult(r))
  );
  return mergeResults(processed);
};
```

## Error Handling

### Retry Delegation

```typescript
const retryDelegation = async (agent, task, maxRetries = 3) => {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await agent.execute(task);
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await delay(1000 * Math.pow(2, i));
    }
  }
};
```

### Fallback Delegation

```typescript
const fallbackDelegation = async (primary, fallback, task) => {
  try {
    return await primary.execute(task);
  } catch (error) {
    console.log('Primary failed, trying fallback');
    return await fallback.execute(task);
  }
};
```

## Monitoring

### Delegation Tracking

```typescript
const tracker = {
  delegations: [],
  
  track(parent, subagent, task, result) {
    this.delegations.push({
      parent: parent.id,
      subagent: subagent.id,
      task: task.id,
      status: result.status,
      duration: result.duration
    });
  }
};
```

### Performance Metrics

- Delegation latency
- Subagent utilization
- Task completion rate
- Error rate by agent

## Best Practices

1. **Clear contracts**: Define exactly what each subagent does
2. **Minimal context**: Pass only necessary information
3. **Error boundaries**: Handle subagent failures gracefully
4. **Timeout handling**: Set reasonable timeouts for delegated tasks
5. **Result validation**: Verify subagent outputs
