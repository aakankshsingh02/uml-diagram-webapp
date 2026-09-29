import art
from art.langgraph import init_chat_model, wrap_rollout
from langchain_core.messages import HumanMessage, SystemMessage
from openai.types.chat.chat_completion import Choice

from .scenarios import Scenario

MAX_TOKENS = 4096
TIMEOUT_S = 180


def _text(content: object) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):  # LangChain content blocks
        return "".join(b.get("text", "") if isinstance(b, dict) else str(b) for b in content)
    return str(content)


async def rollout(model: art.Model, scenario: Scenario) -> art.Trajectory:
    """One on-policy completion for the scenario's exact system/user prompt.

    `logprobs=True` matters: ART's LangGraph converter only turns a reply into a trainable
    `Choice` when the response carries logprobs; without it the reply is a plain message and
    contributes nothing to training.
    """
    chat = init_chat_model(
        model.get_inference_name(),
        temperature=1.0,
        logprobs=True,
        max_tokens=MAX_TOKENS,
        timeout=TIMEOUT_S,
    )
    reply = await chat.ainvoke([SystemMessage(scenario.system), HumanMessage(scenario.user)])
    return art.Trajectory(
        reward=0.0,
        messages_and_choices=[],
        metadata={"scenario_id": scenario.id, "reply": _text(reply.content)},
    )


def has_trainable_choice(trajectory: art.Trajectory) -> bool:
    """True when wrap_rollout captured the model's reply as a Choice (it swallows conversion errors)."""
    return any(isinstance(m, Choice) for m in trajectory.messages_and_choices)


def rollout_group(model: art.Model, scenario: Scenario, n: int):
    """An awaitable TrajectoryGroup of `n` wrapped rollouts for one scenario."""
    wrapped = wrap_rollout(model, rollout)
    return art.TrajectoryGroup(wrapped(model, scenario) for _ in range(n))
