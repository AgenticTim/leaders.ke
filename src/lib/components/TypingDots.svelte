<!-- The animated ellipsis after "… is typing" — three dots fading in sequence;
the label text itself stays still. -->
<span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>

<style>
	.dots {
		display: inline-flex;
		align-items: baseline;
		gap: 2px;
		margin-left: 3px;
	}
	.dots i {
		width: 3.5px;
		height: 3.5px;
		border-radius: 9999px;
		background: currentColor;
		animation: dot 1.2s infinite;
	}
	.dots i:nth-child(2) {
		animation-delay: 0.2s;
	}
	.dots i:nth-child(3) {
		animation-delay: 0.4s;
	}
	@keyframes dot {
		0%,
		60%,
		100% {
			opacity: 0.25;
		}
		30% {
			opacity: 1;
		}
	}
</style>
