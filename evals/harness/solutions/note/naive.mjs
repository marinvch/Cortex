// T3, breaking R3: new orders store the note, which is all the prompt asks for. No migration ran,
// so the stored rows of orders that already exist never get the field.

import { SERVICE } from "./good.mjs";

export default [...SERVICE];
