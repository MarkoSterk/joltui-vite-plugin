import { component as element, CustomElement, page as route } from "joltui";

@route("/profile")
@element({ tagName: "profile-page" })
export default class ProfilePage extends CustomElement {}
