import uuid
import time
import json
import subprocess
from enum import Enum
from typing import List, Dict, Any

from llm_helper import call_llm
from agent_tools import get_agent_tools

class AgentStatus(Enum):
    CREATED = "CREATED"
    AWAKE = "AWAKE"
    SLEEPING = "SLEEPING"
    TERMINATED = "TERMINATED"

class MessageType(Enum):
    TEXT = "TEXT"
    IMAGE = "IMAGE"
    COMMAND = "COMMAND"

class Message:
    def __init__(self, sender_id: str, receiver_id: str, content: str, msg_type: MessageType = MessageType.TEXT):
        self.id = str(uuid.uuid4())
        self.sender_id = sender_id
        self.receiver_id = receiver_id
        self.content = content
        self.msg_type = msg_type
        self.timestamp = time.time()

    def __str__(self):
        return f"[{self.msg_type.value}] {self.sender_id} -> {self.receiver_id}: {self.content}"

class BaseEntity:
    def __init__(self, name: str, entity_id: str = None):
        self.id = entity_id or str(uuid.uuid4())
        self.name = name
        self.history: List[Message] = []

    def receive_message(self, message: Message):
        self.history.append(message)
        self.handle_message(message)

    def handle_message(self, message: Message):
        pass

class User(BaseEntity):
    def __init__(self, name: str, orchestrator):
        super().__init__(name, entity_id=f"user_{name}")
        self.orchestrator = orchestrator

    def send_message(self, receiver_id: str, content: str, msg_type: MessageType = MessageType.TEXT):
        msg = Message(self.id, receiver_id, content, msg_type)
        self.history.append(msg)
        self.orchestrator.route_message(msg)

    def handle_message(self, message: Message):
        print(f"\n[User: {self.name} received] {message.sender_id}: {message.content}")

    def create_agent(self, name: str, role: str, **kwargs):
        agent = self.orchestrator.create_agent(name, role, **kwargs)
        print(f"\n[User: {self.name}] Created new agent: {agent.name} ({agent.id})")
        return agent

class Agent(BaseEntity):
    def __init__(self, name: str, role: str, orchestrator, parent_id: str = None):
        super().__init__(name, entity_id=f"agent_{name}_{str(uuid.uuid4())[:4]}")
        self.role = role
        self.orchestrator = orchestrator
        self.status = AgentStatus.CREATED
        
        # Relationships
        self.parent_id = parent_id
        self.sub_agents: List[str] = []
        self.peers: List[str] = []
        
        # Capabilities
        self.skills: List[str] = []
        self.tools: List[str] = []
        self.resources: Dict[str, Any] = {}
        self.templates: Dict[str, str] = {}
        
        # Internal LLM conversation context
        self.system_prompt = f"""You are an autonomous agent in a multi-agent system.
Your Name: {self.name}
Your ID: {self.id}
Your Role: {self.role}
Parent ID: {self.parent_id}

You have the ability to read/write files and run shell commands to inspect the codebase and even modify yourself (self-evolve).
You can spawn sub-agents or peer agents for complex tasks.
You can send messages to other entities using their IDs.

When asked to process something, use the available tools to accomplish the goal, and reply to the requester with the final answer using `send_message`.
"""
        self.llm_history = [{"role": "system", "content": self.system_prompt}]
        
        print(f"[System] Agent '{self.name}' ({self.role}) has been CREATED.")

    def wake_up(self):
        if self.status != AgentStatus.AWAKE:
            self.status = AgentStatus.AWAKE
            print(f"[System] Agent '{self.name}' is now AWAKE.")

    def sleep(self):
        if self.status == AgentStatus.AWAKE:
            self.status = AgentStatus.SLEEPING
            print(f"[System] Agent '{self.name}' is now SLEEPING.")

    def terminate(self):
        self.status = AgentStatus.TERMINATED
        print(f"[System] Agent '{self.name}' has been TERMINATED.")

    def send_message(self, receiver_id: str, content: str, msg_type: MessageType = MessageType.TEXT):
        msg = Message(self.id, receiver_id, content, msg_type)
        self.history.append(msg)
        self.orchestrator.route_message(msg)

    def spawn_sub_agent(self, name: str, role: str):
        sub_agent = self.orchestrator.create_agent(name, role, parent_id=self.id)
        self.sub_agents.append(sub_agent.id)
        print(f"[Agent: {self.name}] Spawned sub-agent '{sub_agent.name}' for specialized tasks.")
        return sub_agent

    def spawn_peer_agent(self, name: str, role: str):
        peer_agent = self.orchestrator.create_agent(name, role, parent_id=self.parent_id)
        self.peers.append(peer_agent.id)
        peer_agent.peers.append(self.id)
        print(f"[Agent: {self.name}] Spawned peer agent '{peer_agent.name}' for parallel tasks.")
        return peer_agent

    def execute_tool_call(self, tool_call):
        func_name = tool_call.function.name
        args = json.loads(tool_call.function.arguments)
        print(f"[{self.name} Tool Execution] {func_name}({args})")
        
        if func_name == "send_message":
            self.send_message(args["receiver_id"], args["content"])
            return "Message sent successfully."
            
        elif func_name == "spawn_sub_agent":
            sub = self.spawn_sub_agent(args["name"], args["role"])
            self.send_message(sub.id, args["initial_task"])
            return f"Sub-agent spawned with ID: {sub.id}"
            
        elif func_name == "spawn_peer_agent":
            peer = self.spawn_peer_agent(args["name"], args["role"])
            self.send_message(peer.id, args["initial_task"])
            return f"Peer agent spawned with ID: {peer.id}"
            
        elif func_name == "run_shell_command":
            try:
                result = subprocess.run(args["command"], shell=True, capture_output=True, text=True, timeout=30)
                output = f"STDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
                return output
            except Exception as e:
                return str(e)
                
        elif func_name == "read_file":
            try:
                with open(args["file_path"], "r", encoding="utf-8") as f:
                    return f.read()
            except Exception as e:
                return str(e)
                
        elif func_name == "write_file":
            try:
                with open(args["file_path"], "w", encoding="utf-8") as f:
                    f.write(args["content"])
                return "File written successfully."
            except Exception as e:
                return str(e)
                
        return "Unknown function."

    def handle_message(self, message: Message):
        self.wake_up()
        print(f"\n[Agent: {self.name} ({self.role}) thinking...] Received from {message.sender_id}")
        
        # Add to LLM history
        self.llm_history.append({
            "role": "user",
            "content": f"Message from {message.sender_id}:\n{message.content}"
        })
        
        tools = get_agent_tools()
        
        while True:
            llm_msg = call_llm(self.llm_history, tools=tools)
            if not llm_msg:
                print(f"[Agent: {self.name}] LLM Error, cannot proceed.")
                break
                
            # Add assistant message to history
            self.llm_history.append(llm_msg.model_dump(exclude_unset=True))
            
            if llm_msg.tool_calls:
                for tool_call in llm_msg.tool_calls:
                    tool_result = self.execute_tool_call(tool_call)
                    
                    self.llm_history.append({
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "content": str(tool_result)
                    })
            else:
                # If the agent just replies with text directly, we can optionally send it back to the sender
                if llm_msg.content:
                    print(f"[Agent: {self.name} Direct Reply]: {llm_msg.content}")
                    # Usually, we encourage the agent to use 'send_message' tool to reply.
                    # If they just output text, we can forward it to the sender.
                    self.send_message(message.sender_id, llm_msg.content)
                break
                
        self.sleep()

class SystemOrchestrator:
    def __init__(self):
        self.entities: Dict[str, BaseEntity] = {}

    def register_entity(self, entity: BaseEntity):
        self.entities[entity.id] = entity

    def create_agent(self, name: str, role: str, parent_id: str = None) -> Agent:
        agent = Agent(name, role, self, parent_id)
        self.register_entity(agent)
        return agent

    def route_message(self, message: Message):
        # Simulate network/routing delay
        time.sleep(0.5)
        receiver = self.entities.get(message.receiver_id)
        if receiver:
            receiver.receive_message(message)
        else:
            print(f"[System Error] Message delivery failed. Receiver {message.receiver_id} not found.")

def main():
    print("="*60)
    print("Agentic Dialogue System with DeepSeek API")
    print("="*60)
    
    orchestrator = SystemOrchestrator()
    user = User("Alice", orchestrator)
    orchestrator.register_entity(user)
    
    coordinator = user.create_agent("Coordinator_Prime", "Task Coordinator")
    
    # 1. Ask the agent to introspect and modify itself using git
    print("\n--- User asks agent to evolve ---")
    prompt = "Please look at the code of `agent_system.py` in the current directory. Identify one small improvement you can make (e.g. adding a comment, or adding a small feature), modify the file, and then commit the changes using git."
    user.send_message(coordinator.id, prompt)
    
if __name__ == "__main__":
    main()
