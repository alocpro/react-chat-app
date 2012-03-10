$(function () {
    $('#login .toggle-register').click(function () {
        var $register = $('#login .register');
        var $form = $('#login form');
        var $link = $('#login .toggle-register');
        if ($register.is(':visible')) {
            $form.attr('action', '/login');
            $register.slideUp();
            $link.text('New? Create an account.');
        } else {
            $form.attr('action', '/register');
            $register.slideDown();
            $link.text('Actually, I have an account.');
        }
    });
});
