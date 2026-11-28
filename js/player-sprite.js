
const palettes = [
    { main: "#35a7ff", dark: "#1767b3", light: "#a9ddff" },
    { main: "#ff4d4d", dark: "#b91c1c", light: "#ffaaaa" },
    { main: "#43c967", dark: "#187a3a", light: "#a5edb7" },
    { main: "#ad63ef", dark: "#7134a6", light: "#dfbaff" }
];

export function createPlayerSprite(identityIndex) {
    const palette = palettes[identityIndex % palettes.length];

    const sprite = document.createElement("span");
    sprite.classList.add("player-sprite");

    sprite.innerHTML = `
        <svg
            viewBox="0 0 40 48"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
            shape-rendering="crispEdges"
            style="
                --sprite-main: ${palette.main};
                --sprite-dark: ${palette.dark};
                --sprite-light: ${palette.light};
            "
        >
            <!-- Helmet -->
            <rect x="10" y="2" width="20" height="4" fill="var(--sprite-dark)"/>
            <rect x="6" y="6" width="28" height="8" fill="var(--sprite-main)"/>
            <rect x="9" y="6" width="22" height="3" fill="var(--sprite-light)"/>
            <rect x="4" y="12" width="32" height="4" fill="var(--sprite-dark)"/>

            <!-- Face -->
            <rect x="9" y="16" width="22" height="12" fill="#f3c9a5"/>
            <rect x="12" y="19" width="4" height="4" fill="#263238"/>
            <rect x="24" y="19" width="4" height="4" fill="#263238"/>
            <rect x="17" y="25" width="6" height="2" fill="#9b5c49"/>

            <!-- Body -->
            <rect x="8" y="28" width="24" height="12" fill="var(--sprite-main)"/>
            <rect x="12" y="30" width="16" height="3" fill="var(--sprite-light)"/>
            <rect x="16" y="34" width="8" height="4" fill="var(--sprite-dark)"/>

            <!-- Arms -->
            <rect x="2" y="29" width="6" height="10" fill="var(--sprite-dark)"/>
            <rect x="32" y="29" width="6" height="10" fill="var(--sprite-dark)"/>

            <!-- Legs -->
            <rect x="10" y="40" width="8" height="5" fill="var(--sprite-dark)"/>
            <rect x="22" y="40" width="8" height="5" fill="var(--sprite-dark)"/>

            <!-- Boots -->
            <rect x="7" y="44" width="12" height="4" fill="#263238"/>
            <rect x="21" y="44" width="12" height="4" fill="#263238"/>
        </svg>
    `;

    return sprite;
}
