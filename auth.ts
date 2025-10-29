callbacks: {
  async session({ session }) {
    let role = "user";
    if (session.user?.email === "jwes9121@gmail.com") {
      role = "admin";
    }

    return {
      ...session,
      user: {
        ...session.user,
        role,
      },
    };
  },
}
