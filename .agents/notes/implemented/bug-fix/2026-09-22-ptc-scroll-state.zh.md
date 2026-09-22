# Agent Note: 明确 PTC expanded golden 的滚动状态

Status: implemented

[English](2026-09-22-ptc-scroll-state.md) | 中文

## Problem

PTC expanded ARIA golden 在打开嵌套行后没有声明会话滚动位置。布局增高与跟随滚动 observer 的时序可能让捕获停在底部或略高于底部，导致只有无关的 `Back to bottom` 控件不同。

## Decision

PTC 捕获调用 `captureExpandedTurnProcessAria` 时传入 `scrollToBottom: true`。共享 helper 会把会话滚到末端，并等待几何位置满足条件且 `Back to bottom` 控件消失后再捕获。因此 golden 只覆盖嵌套 PTC 呈现，不依赖瞬时的滚动控件状态。

## Alternatives considered

**再次刷新 golden。** 不采用，因为再次刷新仍会保留偶然的滚动状态，而不是定义场景输入。

**重试浏览器测试。** 不采用，因为重试会隐藏时序相关状态，不能证明 ARIA 捕获是确定的。

**在归一化阶段移除控件。** 不采用，因为该控件对用户可见，其他滚动场景仍必须断言它。

## Consequences

PTC 测试现在会先建立明确的阅读位置，再验证其目标嵌套行。这不改变产品行为；离开底部后的滚动行为仍由专门的 chat-scroll 场景覆盖。
